import React, { useState, useRef, useEffect } from 'react';
import { Video, VideoOff, Mic, MicOff, Phone, PhoneOff, MessageSquare, Users, Monitor, Copy, Check, MonitorOff, Send, Image as ImageIcon, Paperclip, MoreVertical, Edit2, Trash2, Pin, Heart, ThumbsUp, ThumbsDown, Smile, X, Menu, AlertCircle, WifiOff } from 'lucide-react';
import io from 'socket.io-client';
import './App.css';

const SOCKET_SERVER_URL = 'https://meethub-khyr.onrender.com';

export default function VideoConferenceApp() {
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [isInRoom, setIsInRoom] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [copied, setCopied] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Déconnecté');
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false);
  const [iceConfig, setIceConfig] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [showMessageMenu, setShowMessageMenu] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [userVideoStatus, setUserVideoStatus] = useState({});
  const [notification, setNotification] = useState(null);
  const [isCreator, setIsCreator] = useState(false);
  const [mediaState, setMediaState] = useState(null);
  const [showMediaPlayer, setShowMediaPlayer] = useState(false);
  const [isFetchingTurn, setIsFetchingTurn] = useState(false);
  const [connectionProblems, setConnectionProblems] = useState({}); // { peerId: true/false }
  const mediaPlayerRef = useRef(null);

  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const chatMessagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const messageMenuRefs = useRef({});
  const messageInputRef = useRef(null);

  // ============ STRUCTURE DE DONNÉES POUR PERFECT NEGOTIATION ============
  const peerConnectionsRef = useRef({}); // { peerId: RTCPeerConnection }
  
  // SENDER RÉFÉRENCE - STOCKAGE DES SENDERS
  const videoSendersRef = useRef({}); // { peerId: RTCRtpSender }
  const audioSendersRef = useRef({}); // { peerId: RTCRtpSender }
  
  // Perfect Negotiation tracking (MDN standard)
  const negotiationStateRef = useRef({}); // {
  //   [peerId]: {
  //     makingOffer: boolean,
  //     ignoreOffer: boolean,
  //     isPolite: boolean,
  //     isSettingRemoteAnswerPending: boolean
  //   }
  // }
  
  // Original camera track storage for screen sharing
  const originalVideoTracksRef = useRef({}); // { peerId: MediaStreamTrack }
  
  // ICE candidates queue
  const iceCandidatesQueueRef = useRef({}); // { peerId: RTCIceCandidate[] }
  
  // Screen sharing state
  const screenStreamRef = useRef(null);
  
  // ICE restart attempts tracking
  const iceRestartAttemptsRef = useRef({}); // { peerId: number }
  
  const emojis = ['❤️', '👍', '👎', '😂', '😮', '😢', '🎉'];

  // ============ CONFIGURATION WEBRTC REQUISE ============
  const getRTCConfiguration = () => {
    if (iceConfig && iceConfig.iceServers) {
      return {
        iceServers: iceConfig.iceServers,
        bundlePolicy: "max-bundle", // FORCE bundle (audio+video+screen même port)
        rtcpMuxPolicy: "require",
        iceTransportPolicy: "all",
        iceCandidatePoolSize: 10
      };
    }
    
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      bundlePolicy: "max-bundle", // FORCE bundle (audio+video+screen même port)
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 10
    };
  };

  // ============ PERFECT NEGOTIATION: CREATE PEER CONNECTION ============
  const createPeerConnection = (peerId, isPolite = false) => {
    console.log(`🔗 Création PeerConnection pour ${peerId} (polite: ${isPolite})`);
    
    // Cleanup existing connection
    if (peerConnectionsRef.current[peerId]) {
      console.log(`🧹 Nettoyage ancienne connexion pour ${peerId}`);
      peerConnectionsRef.current[peerId].close();
      delete peerConnectionsRef.current[peerId];
    }
    
    // Initialize negotiation state
    negotiationStateRef.current[peerId] = {
      makingOffer: false,
      ignoreOffer: false,
      isPolite: isPolite,
      isSettingRemoteAnswerPending: false
    };
    
    // Initialize ICE queue
    iceCandidatesQueueRef.current[peerId] = [];
    
    // Initialize ICE restart attempts
    iceRestartAttemptsRef.current[peerId] = 0;
    
    // Create new PeerConnection with required configuration
    const pc = new RTCPeerConnection(getRTCConfiguration());
    peerConnectionsRef.current[peerId] = pc;
    
    // ============ PERFECT NEGOTIATION: onnegotiationneeded AVEC VERROU STRICT ============
    pc.onnegotiationneeded = async () => {
      console.log(`🔄 Negotiation needed pour ${peerId} (state: ${pc.signalingState})`);
      
      const state = negotiationStateRef.current[peerId];
      if (!state) return;
      
      // VERROU DE NÉGOCIATION STRICT
      if (pc.signalingState !== "stable" || state.makingOffer) {
        console.log(`🔒 Negotiation bloquée: signalingState=${pc.signalingState}, makingOffer=${state.makingOffer}`);
        return;
      }
      
      try {
        state.makingOffer = true;
        
        // Create offer
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        
        // Set local description
        await pc.setLocalDescription(offer);
        console.log(`✅ Offer créée pour ${peerId}`);
        
        // Send offer via signaling
        socketRef.current.emit('offer', {
          to: peerId,
          offer: pc.localDescription
        });
        
      } catch (err) {
        console.error(`❌ Erreur création offer pour ${peerId}:`, err);
      } finally {
        state.makingOffer = false;
      }
    };
    
    // ============ ICE CONNECTION HANDLING ============
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`🔌 ICE state pour ${peerId}: ${state}`);
      
      // Gestion des problèmes de connexion
      if (state === "disconnected" || state === "failed") {
        console.warn(`⚠️ Problème ICE pour ${peerId}: ${state}`);
        
        // Marquer le participant comme ayant des problèmes de connexion
        setConnectionProblems(prev => ({ ...prev, [peerId]: true }));
        
        if (state === "failed") {
          // Premier restart automatique
          if (iceRestartAttemptsRef.current[peerId] < 1) {
            iceRestartAttemptsRef.current[peerId]++;
            setTimeout(() => {
              if (pc.iceConnectionState === "failed") {
                console.log(`🔄 Tentative ICE restart pour ${peerId}`);
                restartIce(peerId);
              }
            }, 1000);
          } else {
            // Après le premier échec, on affiche juste le bouton de réparation
            console.log(`⚠️ ICE failed pour ${peerId} - bouton de réparation affiché`);
          }
        }
      } else if (state === "connected" || state === "completed") {
        // Connexion rétablie
        console.log(`✅ Connexion ICE établie avec ${peerId}`);
        setConnectionProblems(prev => ({ ...prev, [peerId]: false }));
        iceRestartAttemptsRef.current[peerId] = 0; // Reset attempts
      }
    };
    
    pc.onconnectionstatechange = () => {
      console.log(`🔌 Connection state pour ${peerId}: ${pc.connectionState}`);
    };
    
    pc.onsignalingstatechange = () => {
      console.log(`📡 Signaling state pour ${peerId}: ${pc.signalingState}`);
    };
    
    // ============ TRACK MANAGEMENT ============
    // Add local tracks if we have them
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try {
          if (track.kind === "video") {
            // STOCKER LE SENDER VIDEO
            const sender = pc.addTrack(track, localStreamRef.current);
            videoSendersRef.current[peerId] = sender;
            console.log(`🎥 Video track ajouté à ${peerId} (sender stocké)`);
          } else if (track.kind === "audio") {
            // STOCKER LE SENDER AUDIO
            const sender = pc.addTrack(track, localStreamRef.current);
            audioSendersRef.current[peerId] = sender;
            console.log(`🎤 Audio track ajouté à ${peerId} (sender stocké)`);
          }
        } catch (err) {
          console.error(`❌ Erreur ajout track ${track.kind} à ${peerId}:`, err);
        }
      });
    }
    
    // ============ REMOTE TRACK HANDLING ============
    pc.ontrack = (event) => {
      console.log(`📹 Track reçu de ${peerId}:`, event.track.kind);
      
      // Create or update remote stream
      setRemoteStreams(prev => {
        const existingStream = prev[peerId];
        
        if (existingStream) {
          // Check if track already exists
          const existingTrack = existingStream.getTracks().find(t => t.id === event.track.id);
          if (!existingTrack) {
            existingStream.addTrack(event.track);
            console.log(`➕ Track ${event.track.kind} ajouté au stream de ${peerId}`);
          }
          return { ...prev, [peerId]: existingStream };
        } else {
          // Create new stream
          const newStream = event.streams[0] || new MediaStream([event.track]);
          console.log(`✅ Nouveau stream créé pour ${peerId}`);
          return { ...prev, [peerId]: newStream };
        }
      });
    };
    
    // ============ ICE CANDIDATE HANDLING ============
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`🧊 ICE candidate généré pour ${peerId}`);
        socketRef.current.emit('ice-candidate', {
          to: peerId,
          candidate: event.candidate
        });
      }
    };
    
    // ============ ICE CANDIDATE ERROR ============
    pc.onicecandidateerror = (event) => {
      console.warn(`⚠️ ICE candidate error pour ${peerId}:`, event.errorCode, event.errorText);
    };
    
    return pc;
  };

  // ============ ICE RESTART ============
  const restartIce = async (peerId) => {
    const pc = peerConnectionsRef.current[peerId];
    if (!pc) return;
    
    const state = negotiationStateRef.current[peerId];
    if (!state) return;
    
    try {
      console.log(`🔄 ICE restart manuel pour ${peerId}`);
      
      // Only restart if we're stable and not already making an offer
      if (pc.signalingState === "stable" && !state.makingOffer) {
        state.makingOffer = true;
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        
        socketRef.current.emit('offer', {
          to: peerId,
          offer: pc.localDescription
        });
        
        console.log(`✅ ICE restart offer envoyée à ${peerId}`);
      } else {
        console.log(`⚠️ Impossible de restart ICE: signalingState=${pc.signalingState}, makingOffer=${state.makingOffer}`);
      }
    } catch (err) {
      console.error(`❌ Erreur ICE restart pour ${peerId}:`, err);
    } finally {
      state.makingOffer = false;
    }
  };

  // ============ MANUAL CONNECTION REPAIR ============
  const repairConnection = (peerId) => {
    console.log(`🔧 Réparation manuelle de la connexion pour ${peerId}`);
    restartIce(peerId);
    
    // Reset attempts to allow automatic restart if needed again
    iceRestartAttemptsRef.current[peerId] = 0;
    setConnectionProblems(prev => ({ ...prev, [peerId]: false }));
    
    setNotification({
      message: `Tentative de réparation de la connexion avec ${participants.find(p => p.id === peerId)?.name || 'le participant'}`,
      type: 'info',
      timestamp: Date.now()
    });
  };

  // ============ PERFECT NEGOTIATION: HANDLE OFFER ============
  const handleOffer = async (peerId, remoteOffer) => {
    console.log(`📨 Traitement offer de ${peerId}`);
    
    const pc = peerConnectionsRef.current[peerId];
    if (!pc) {
      console.warn(`⚠️ Aucun PeerConnection pour ${peerId}, création...`);
      createPeerConnection(peerId, true); // Receiver is polite
      return;
    }
    
    const state = negotiationStateRef.current[peerId];
    if (!state) {
      console.error(`❌ État de négociation manquant pour ${peerId}`);
      return;
    }
    
    try {
      // ============ PERFECT NEGOTIATION: OFFER COLLISION DETECTION ============
      const offerCollision = state.makingOffer || pc.signalingState !== "stable";
      
      state.ignoreOffer = !state.isPolite && offerCollision;
      if (state.ignoreOffer) {
        console.log(`⚠️ Offer ignorée (collision détectée, nous sommes impolite): ${peerId}`);
        return;
      }
      
      // ============ ROLLBACK IF POLITE PEER ============
      if (state.isPolite && offerCollision) {
        console.log(`✅ Peer poli ${peerId}: rollback local description`);
        await Promise.all([
          pc.setLocalDescription({ type: "rollback" }),
          pc.setRemoteDescription(new RTCSessionDescription(remoteOffer))
        ]);
      } else {
        // Normal offer processing
        await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
      }
      
      console.log(`✅ remoteDescription défini pour ${peerId}`);
      
      // ============ FLUSH QUEUED ICE CANDIDATES ============
      await flushIceCandidates(peerId, pc);
      
      // ============ CREATE AND SEND ANSWER ============
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socketRef.current.emit('answer', {
        to: peerId,
        answer: pc.localDescription
      });
      
      console.log(`📤 Answer envoyé à ${peerId}`);
      
    } catch (err) {
      console.error(`❌ Erreur traitement offer de ${peerId}:`, err);
    }
  };

  // ============ PERFECT NEGOTIATION: HANDLE ANSWER ============
  const handleAnswer = async (peerId, remoteAnswer) => {
    console.log(`📨 Traitement answer de ${peerId}`);
    
    const pc = peerConnectionsRef.current[peerId];
    if (!pc) {
      console.warn(`⚠️ Aucun PeerConnection pour ${peerId} pour answer`);
      return;
    }
    
    const state = negotiationStateRef.current[peerId];
    if (!state) {
      console.error(`❌ État de négociation manquant pour ${peerId}`);
      return;
    }
    
    try {
      // ============ PERFECT NEGOTIATION: ANSWER VALIDATION ============
      // Only accept answer if we're in "have-local-offer" state
      if (pc.signalingState !== "have-local-offer") {
        console.warn(`⚠️ Answer ignorée: signalingState = ${pc.signalingState}`);
        return;
      }
      
      state.isSettingRemoteAnswerPending = true;
      await pc.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
      state.isSettingRemoteAnswerPending = false;
      
      console.log(`✅ Answer acceptée pour ${peerId}`);
      
      // ============ FLUSH QUEUED ICE CANDIDATES ============
      await flushIceCandidates(peerId, pc);
      
    } catch (err) {
      console.error(`❌ Erreur traitement answer de ${peerId}:`, err);
      state.isSettingRemoteAnswerPending = false;
    }
  };

  // ============ ICE CANDIDATE HANDLING ============
  const handleIceCandidate = async (peerId, candidate) => {
    console.log(`🧊 Traitement ICE candidate de ${peerId}`);
    
    const pc = peerConnectionsRef.current[peerId];
    if (!pc) {
      console.warn(`⚠️ Aucun PeerConnection pour ${peerId}, queue ICE candidate`);
      // Queue candidate for later
      if (!iceCandidatesQueueRef.current[peerId]) {
        iceCandidatesQueueRef.current[peerId] = [];
      }
      iceCandidatesQueueRef.current[peerId].push(candidate);
      return;
    }
    
    try {
      // If remote description is set, add candidate immediately
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`✅ ICE candidate ajouté pour ${peerId}`);
      } else {
        // Queue candidate until remote description is set
        console.log(`📥 ICE candidate mis en queue pour ${peerId}`);
        if (!iceCandidatesQueueRef.current[peerId]) {
          iceCandidatesQueueRef.current[peerId] = [];
        }
        iceCandidatesQueueRef.current[peerId].push(candidate);
      }
    } catch (err) {
      console.error(`❌ Erreur ajout ICE candidate pour ${peerId}:`, err);
    }
  };

  // ============ FLUSH QUEUED ICE CANDIDATES ============
  const flushIceCandidates = async (peerId, pc) => {
    const queue = iceCandidatesQueueRef.current[peerId];
    if (!queue || queue.length === 0) return;
    
    console.log(`🔄 Évacuation de ${queue.length} ICE candidates pour ${peerId}`);
    
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn(`⚠️ Erreur évacuation ICE candidate pour ${peerId}:`, err);
      }
    }
    
    // Clear queue
    iceCandidatesQueueRef.current[peerId] = [];
  };

  // ============ SCREEN SHARING: START (SINGLE PEER CONNECTION - ZERO SIGNALING) ============
  const startScreenShare = async () => {
    console.log('🖥️ Démarrage du partage d\'écran (ZERO SIGNALING)...');
    
    try {
      // Get screen stream
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          cursor: "always",
          displaySurface: "monitor"
        },
        audio: false
      });
      
      screenStreamRef.current = screenStream;
      const screenTrack = screenStream.getVideoTracks()[0];
      
      if (!screenTrack) {
        throw new Error("Aucun track vidéo dans le stream d'écran");
      }
      
      // Stocker la piste vidéo originale pour chaque participant
      Object.keys(peerConnectionsRef.current).forEach(peerId => {
        // Stocker la caméra originale si ce n'est pas déjà fait
        if (!originalVideoTracksRef.current[peerId]) {
          const originalTrack = localStreamRef.current?.getVideoTracks()[0];
          if (originalTrack) {
            originalVideoTracksRef.current[peerId] = originalTrack;
            console.log(`💾 Caméra originale stockée pour ${peerId}`);
          }
        }
      });
      
      // ============ PARTAGE D'ÉCRAN SANS NÉGOCIATION - ZERO SIGNALING ============
      Object.entries(peerConnectionsRef.current).forEach(([peerId, pc]) => {
        const videoSender = videoSendersRef.current[peerId];
        if (videoSender) {
          // Remplacer le track avec l'écran - PAS DE RENÉGOCIATION
          videoSender.replaceTrack(screenTrack);
          console.log(`🔄 Track écran remplacé pour ${peerId} (zero signaling)`);
        }
      });
      
      setIsScreenSharing(true);
      console.log('✅ Partage d\'écran démarré (SINGLE PEER CONNECTION - ZERO SIGNALING)');
      
      // Handle screen sharing stop by user
      screenTrack.onended = () => {
        console.log('🖥️ Partage d\'écran terminé par l\'utilisateur');
        stopScreenShare();
      };
      
      // Notify other participants (pour l'UI seulement)
      socketRef.current.emit('screen-share-start', { roomId });
      
    } catch (err) {
      console.error('❌ Erreur démarrage partage écran:', err);
      if (err.name !== 'NotAllowedError') {
        alert('Impossible de partager l\'écran');
      }
    }
  };

  // ============ SCREEN SHARING: STOP ============
  const stopScreenShare = () => {
    console.log('🖥️ Arrêt du partage d\'écran...');
    
    if (!screenStreamRef.current) {
      console.warn('⚠️ Aucun stream d\'écran actif');
      return;
    }
    
    // Stop screen track
    screenStreamRef.current.getTracks().forEach(track => track.stop());
    screenStreamRef.current = null;
    
    // ============ RESTORER LA CAMÉRA ORIGINALE (ZERO SIGNALING) ============
    Object.entries(peerConnectionsRef.current).forEach(([peerId, pc]) => {
      const videoSender = videoSendersRef.current[peerId];
      const originalTrack = originalVideoTracksRef.current[peerId];
      
      if (videoSender && originalTrack) {
        // Restaurer la caméra originale - PAS DE RENÉGOCIATION
        videoSender.replaceTrack(originalTrack);
        console.log(`🔄 Caméra restaurée pour ${peerId} (zero signaling)`);
      }
      
      // Nettoyer le stockage
      delete originalVideoTracksRef.current[peerId];
    });
    
    setIsScreenSharing(false);
    console.log('✅ Partage d\'écran arrêté');
    
    // Notify other participants (pour l'UI seulement)
    socketRef.current.emit('screen-share-stop', { roomId });
  };

  // ============ TOGGLE SCREEN SHARE (WRAPPER) ============
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      await startScreenShare();
    }
  };

  // ============ TOGGLE VIDEO/AUDIO (NO RENEGOTIATION) ============
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
        console.log(`🎥 Vidéo ${videoTrack.enabled ? 'activée' : 'désactivée'}`);
        
        // Notify others
        socketRef.current.emit('toggle-video', { 
          roomId, 
          isVideoOn: videoTrack.enabled 
        });
      }
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioOn(audioTrack.enabled);
        console.log(`🎤 Audio ${audioTrack.enabled ? 'activé' : 'désactivé'}`);
        
        // Notify others
        socketRef.current.emit('toggle-audio', { 
          roomId, 
          isAudioOn: audioTrack.enabled 
        });
      }
    }
  };

  // ============ CLEANUP PEER CONNECTION ============
  const cleanupPeerConnection = (peerId) => {
    console.log(`🧹 Nettoyage PeerConnection ${peerId}`);
    
    const pc = peerConnectionsRef.current[peerId];
    if (pc) {
      pc.close();
      delete peerConnectionsRef.current[peerId];
    }
    
    // Nettoyer les senders stockés
    delete videoSendersRef.current[peerId];
    delete audioSendersRef.current[peerId];
    
    // Nettoyer les états
    delete negotiationStateRef.current[peerId];
    delete iceCandidatesQueueRef.current[peerId];
    delete originalVideoTracksRef.current[peerId];
    delete iceRestartAttemptsRef.current[peerId];
    
    // Remove from connection problems
    setConnectionProblems(prev => {
      const updated = { ...prev };
      delete updated[peerId];
      return updated;
    });
    
    // Remove from remote streams
    setRemoteStreams(prev => {
      const updated = { ...prev };
      delete updated[peerId];
      return updated;
    });
  };

  // ============ INITIALIZE LOCAL STREAM ============
  const startLocalStream = async () => {
    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 },
          facingMode: "user"
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      console.log('✅ Stream local initialisé');
      return true;
    } catch (err) {
      console.error('❌ Erreur accès média:', err);
      alert('Impossible d\'accéder à la caméra/micro');
      return false;
    }
  };

  // ============ JOIN ROOM ============
  const joinRoom = async () => {
    if (!userName.trim() || !roomId.trim()) {
      alert('Veuillez entrer votre nom et un ID de salle');
      return;
    }

    const success = await startLocalStream();
    if (!success) return;

    setIsInRoom(true);
    setHasJoinedRoom(true);
    
    // Add local participant
    setParticipants([{ 
      id: socketRef.current?.id || 'local', 
      name: userName, 
      isLocal: true 
    }]);
    
    // Join room via signaling
    socketRef.current.emit('join-room', { roomId, userName });
  };

  // ============ LEAVE ROOM ============
  const leaveRoom = () => {
    console.log('🚪 Quitter la salle...');
    
    // Cleanup all peer connections
    Object.keys(peerConnectionsRef.current).forEach(cleanupPeerConnection);
    
    // Stop local streams
    [localStreamRef.current, screenStreamRef.current].forEach(stream => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    });
    
    // Leave signaling room
    if (socketRef.current) {
      socketRef.current.emit('leave-room', { roomId });
    }
    
    // Reset state
    setIsInRoom(false);
    setParticipants([]);
    setRemoteStreams({});
    setIsScreenSharing(false);
    setHasJoinedRoom(false);
    setShowChat(false);
    setShowParticipants(false);
    setConnectionProblems({});
  };

  // ============ SOCKET.IO EVENT HANDLERS ============
  useEffect(() => {
    console.log('🔌 Initialisation Socket.io...');
    
    socketRef.current = io(SOCKET_SERVER_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 10
    });

    socketRef.current.on('connect', () => {
      console.log('✅ Connecté au serveur');
      setConnectionStatus('Connecté');
    });

    socketRef.current.on('disconnect', () => {
      console.log('❌ Déconnecté du serveur');
      setConnectionStatus('Déconnecté');
    });

    // ============ SIGNALING EVENTS ============
    socketRef.current.on('existing-users', (users) => {
      console.log('👥 Utilisateurs existants:', users);
      users.forEach(user => {
        // Add participant
        setParticipants(prev => [...prev, { 
          id: user.id, 
          name: user.name, 
          isLocal: false 
        }]);
        
        // Create peer connection (initiator = polite)
        createPeerConnection(user.id, true);
      });
    });

    socketRef.current.on('user-joined', (user) => {
      console.log('👤 Nouvel utilisateur:', user);
      
      // Add participant
      setParticipants(prev => [...prev, { 
        id: user.id, 
        name: user.name, 
        isLocal: false 
      }]);
      
      // Create peer connection (receiver = impolite)
      createPeerConnection(user.id, false);
    });

    socketRef.current.on('user-left', (user) => {
      console.log('👋 Utilisateur parti:', user);
      
      // Remove participant
      setParticipants(prev => prev.filter(p => p.id !== user.id));
      
      // Cleanup peer connection
      cleanupPeerConnection(user.id);
    });

    // ============ WEBRTC SIGNALING ============
    socketRef.current.on('offer', ({ from, offer }) => {
      console.log('📨 Offer reçue de:', from);
      handleOffer(from, offer);
    });

    socketRef.current.on('answer', ({ from, answer }) => {
      console.log('📨 Answer reçue de:', from);
      handleAnswer(from, answer);
    });

    socketRef.current.on('ice-candidate', ({ from, candidate }) => {
      console.log('🧊 ICE candidate reçu de:', from);
      handleIceCandidate(from, candidate);
    });

    // ============ OTHER EVENTS ============
    socketRef.current.on('chat-message', (message) => {
      setChatMessages(prev => [...prev, message]);
    });

    socketRef.current.on('chat-history', (messages) => {
      setChatMessages(messages);
    });

    socketRef.current.on('toggle-video', ({ userId, isVideoOn }) => {
      setUserVideoStatus(prev => ({ ...prev, [userId]: isVideoOn }));
    });

    socketRef.current.on('screen-share-start', ({ userId }) => {
      console.log(`📺 Partage écran démarré par ${userId}`);
    });

    socketRef.current.on('screen-share-stop', ({ userId }) => {
      console.log(`📺 Partage écran arrêté par ${userId}`);
    });

    socketRef.current.on('join-room-confirmation', ({ success, isCreator }) => {
      if (success) {
        setIsCreator(isCreator || false);
        console.log(`✅ Rejoint la salle, créateur: ${isCreator}`);
      }
    });

    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      
      // Cleanup all peer connections
      Object.keys(peerConnectionsRef.current).forEach(cleanupPeerConnection);
    };
  }, []);

  // ============ TURN CONFIGURATION FETCH ============
  useEffect(() => {
    const fetchTurnCredentials = async () => {
      if (isFetchingTurn) return;
      
      setIsFetchingTurn(true);
      try {
        const response = await fetch(`${SOCKET_SERVER_URL}/api/turn-credentials`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          mode: 'cors'
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // Optimize TURN servers
          const optimizedServers = [
            // Google STUN (fast)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            // TURN servers (max 2 for speed)
            ...(data.iceServers || []).slice(0, 2)
          ];
          
          setIceConfig({ iceServers: optimizedServers });
          console.log('✅ Configuration TURN chargée');
        }
      } catch (err) {
        console.warn('⚠️ Erreur récupération TURN, utilisation STUN seulement');
      } finally {
        setIsFetchingTurn(false);
      }
    };
    
    fetchTurnCredentials();
  }, []);

  // ============ CHAT FUNCTIONS ============
  const sendMessage = () => {
    const trimmedMessage = messageInput.trim();
    if (!trimmedMessage || !hasJoinedRoom || !socketRef.current?.connected) {
      return;
    }

    console.log('💬 Envoi du message:', trimmedMessage);
    socketRef.current.emit('chat-message', { 
      roomId, 
      message: trimmedMessage 
    });
    
    setMessageInput('');
    
    setTimeout(() => {
      messageInputRef.current?.focus();
    }, 100);
  };

  const editMessage = (messageId, currentText) => {
    setEditingMessageId(messageId);
    setEditingText(currentText);
    setShowMessageMenu(null);
  };

  const saveEdit = (messageId) => {
    if (editingText.trim()) {
      console.log('✏️ Édition du message:', messageId);
      socketRef.current.emit('edit-message', { 
        roomId, 
        messageId, 
        newText: editingText 
      });
    }
    setEditingMessageId(null);
    setEditingText('');
  };

  const deleteMessage = (messageId) => {
    if (window.confirm('Supprimer ce message ? Cette action est irréversible.')) {
      console.log('🗑️ Suppression du message:', messageId);
      socketRef.current.emit('delete-message', { roomId, messageId });
      setShowMessageMenu(null);
    }
  };

  const reactToMessage = (messageId, reaction) => {
    console.log('😀 Réaction au message:', messageId, reaction);
    socketRef.current.emit('react-message', { roomId, messageId, reaction });
    setShowEmojiPicker(null);
    setShowMessageMenu(null);
  };

  const pinMessage = (messageId) => {
    console.log('📌 Épinglage du message:', messageId);
    socketRef.current.emit('pin-message', { roomId, messageId });
    setShowMessageMenu(null);
  };

  // ============ UI HELPERS ============
  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (fileType) => {
    if (fileType?.startsWith('image/')) return '🖼️';
    if (fileType?.startsWith('audio/')) return '🎵';
    if (fileType?.startsWith('video/')) return '🎥';
    if (fileType === 'application/pdf') return '📄';
    return '📎';
  };

  const renderMessageMenu = (messageId, isOwnMessage, isPinned) => (
    <div className="message-menu-dropdown">
      {!isOwnMessage && (
        <>
          <button onClick={() => reactToMessage(messageId, '❤️')} className="menu-item">
            <Heart size={14} /> Ajouter ❤️
          </button>
          <button onClick={() => reactToMessage(messageId, '👍')} className="menu-item">
            <ThumbsUp size={14} /> Ajouter 👍
          </button>
          <button onClick={() => reactToMessage(messageId, '👎')} className="menu-item">
            <ThumbsDown size={14} /> Ajouter 👎
          </button>
          <hr className="menu-divider" />
        </>
      )}
      <button onClick={() => pinMessage(messageId)} className="menu-item">
        <Pin size={14} /> {isPinned ? 'Désépingler' : 'Épingler'}
      </button>
      {isOwnMessage && (
        <>
          <button onClick={() => editMessage(messageId, chatMessages.find(m => m.id === messageId)?.text || '')} className="menu-item">
            <Edit2 size={14} /> Modifier
          </button>
          <button onClick={() => deleteMessage(messageId)} className="menu-item danger">
            <Trash2 size={14} /> Supprimer
          </button>
        </>
      )}
    </div>
  );

  // ============ SCROLL TO BOTTOM ============
  useEffect(() => {
    if (chatMessagesEndRef.current) {
      chatMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  // ============ CLICK OUTSIDE HANDLERS ============
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showMessageMenu && !messageMenuRefs.current[showMessageMenu]?.contains(event.target)) {
        setShowMessageMenu(null);
      }
      if (showEmojiPicker && !event.target.closest('.emoji-picker') && !event.target.closest('.add-reaction-btn')) {
        setShowEmojiPicker(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMessageMenu, showEmojiPicker]);

  // ============ RENDER LOGIN SCREEN ============
  if (!isInRoom) {
    return (
      <div className="login-container">
        <div className="neon-glow"></div>
        <div className="login-card">
          <div className="login-header">
            <div className="logo-container">
              <Video className="logo-icon" />
              <div className="logo-rings">
                <div className="ring ring-1"></div>
                <div className="ring ring-2"></div>
                <div className="ring ring-3"></div>
              </div>
            </div>
            <h1 className="app-title">MeetHub Pro</h1>
            <p className="app-subtitle">Architecture WebRTC Professionnelle</p>
            <div className={`status-badge ${connectionStatus === 'Connecté' ? 'connected' : 'disconnected'}`}>
              <span className="status-dot"></span>
              {connectionStatus}
            </div>
            <div className={`ice-status ${iceConfig ? 'configured' : isFetchingTurn ? 'pending' : 'error'}`}>
              <span className="ice-dot"></span>
              {iceConfig ? 'TURN/NAT configuré' : isFetchingTurn ? 'Configuration réseau...' : 'Réseau par défaut'}
            </div>
          </div>

          <div className="login-form">
            <div className="input-group">
              <label>Votre nom</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Entrez votre nom"
                className="futuristic-input"
              />
            </div>

            <div className="input-group">
              <label>ID de la salle</label>
              <div className="input-with-button">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  placeholder="Code de la salle"
                  className="futuristic-input"
                />
                <button onClick={() => setRoomId(generateRoomId())} className="generate-btn">
                  Générer
                </button>
              </div>
            </div>

            <button onClick={joinRoom} className="join-btn">
              <span>Rejoindre la salle</span>
              <div className="btn-glow"></div>
            </button>
          </div>

          <div className="features-list">
            <div className="feature">✓ Single PeerConnection</div>
            <div className="feature">✓ Perfect Negotiation</div>
            <div className="feature">✓ Screen Sharing Zero-Signaling</div>
            <div className="feature">✓ NAT Traversal (bundlePolicy: max-bundle)</div>
            <div className="feature">✓ 100+ participants</div>
            <div className="feature">✓ Qualité HD</div>
            <div className="feature">✓ Interface de secours ICE</div>
          </div>
        </div>
      </div>
    );
  }

  // ============ RENDER VIDEO ROOM ============
  return (
    <div className="video-room">
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          <span>{notification.message}</span>
          <button onClick={() => setNotification(null)} className="notification-close">
            <X size={16} />
          </button>
        </div>
      )}
      
      <header className="room-header">
        <div className="header-left">
          <button className="mobile-menu-btn" onClick={() => {
            const shouldOpen = !isMobileMenuOpen;
            setIsMobileMenuOpen(shouldOpen);
            if (shouldOpen) {
              setActiveTab('chat');
              setShowChat(true);
              setShowParticipants(false);
            } else {
              setShowChat(false);
              setShowParticipants(false);
            }
          }}>
            <Menu />
          </button>
          <h1 className="room-title">MeetHub Pro</h1>
          <div className="room-id-badge">
            <span>Salle: {roomId}</span>
            <button onClick={copyRoomId} className="copy-btn">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <div className="ice-indicator" title={iceConfig ? "Configuration TURN/NAT active" : "Utilisation de STUN par défaut"}>
            <div className={`ice-dot ${iceConfig ? 'active' : 'warning'}`}></div>
            <span>{iceConfig ? 'Réseau optimisé' : 'STUN seulement'}</span>
          </div>
        </div>
        <button onClick={() => { 
          setShowParticipants(!showParticipants); 
          setActiveTab('participants');
          setShowChat(false);
          const isMobile = window.innerWidth <= 480;
          if (isMobile && !showParticipants) {
            setIsMobileMenuOpen(true);
          }
        }} className="participants-btn">
          <Users size={20} />
          <span>{participants.length}</span>
        </button>
      </header>

      <div className="room-content">
        <div className="videos-section">
          {pinnedMessages.length > 0 && (
            <div className="pinned-messages-banner">
              <Pin size={16} />
              <span>{pinnedMessages[pinnedMessages.length - 1].text}</span>
            </div>
          )}

          {showMediaPlayer && mediaState && (
            <div className="media-player-container">
              <div className="media-player-header">
                <span>Média partagé {isCreator && '(Vous contrôlez)'}</span>
                {isCreator && (
                  <button onClick={() => setShowMediaPlayer(false)} className="close-media-btn">
                    <X size={18} />
                  </button>
                )}
              </div>
              <div className="media-player-content">
                {mediaState.type === 'video' && (
                  <video
                    ref={mediaPlayerRef}
                    src={mediaState.url}
                    controls
                    className="media-player-element"
                  />
                )}
                {mediaState.type === 'audio' && (
                  <audio
                    ref={mediaPlayerRef}
                    src={mediaState.url}
                    controls
                    className="media-player-audio"
                  />
                )}
                {mediaState.type === 'pdf' && (
                  <div className="media-player-pdf">
                    <iframe
                      src={`${mediaState.url}#page=${mediaState.pageNumber || 1}`}
                      className="pdf-viewer"
                      title="PDF Viewer"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="videos-grid">
            <div className="video-tile local-video">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="video-element"
              />
              <div className="video-overlay">
                <span className="participant-name">{userName} (Vous)</span>
                <div className="video-indicators">
                  {!isVideoOn && <VideoOff size={16} />}
                  {!isAudioOn && <MicOff size={16} />}
                </div>
              </div>
              {!isVideoOn && (
                <div className="video-off-placeholder">
                  <div className="avatar-placeholder">
                    {userName.charAt(0).toUpperCase()}
                  </div>
                </div>
              )}
            </div>

            {participants.filter(p => !p.isLocal).map((participant) => {
              const hasVideo = remoteStreams[participant.id] && userVideoStatus[participant.id] !== false;
              const stream = remoteStreams[participant.id];
              const videoDisabled = userVideoStatus[participant.id] === false;
              const hasConnectionProblem = connectionProblems[participant.id];
              
              return (
                <div key={participant.id} className="video-tile">
                  <video
                    ref={el => {
                      if (el && stream) {
                        el.srcObject = stream;
                      }
                    }}
                    autoPlay
                    playsInline
                    muted={false}
                    className="video-element"
                    style={{ display: videoDisabled ? 'none' : 'block' }}
                  />
                  <div className="video-overlay">
                    <span className="participant-name">{participant.name}</span>
                    <div className="video-indicators">
                      {videoDisabled && <VideoOff size={16} />}
                      {hasConnectionProblem && <WifiOff size={16} className="connection-problem-icon" />}
                    </div>
                  </div>
                  {(!stream || videoDisabled) && (
                    <div className="video-off-placeholder">
                      <div className="avatar-placeholder">
                        {participant.name.charAt(0).toUpperCase()}
                      </div>
                    </div>
                  )}
                  
                  {/* BOUTON DE RÉPARATION DE CONNEXION */}
                  {hasConnectionProblem && (
                    <div className="connection-repair-overlay">
                      <div className="connection-problem-alert">
                        <AlertCircle size={20} />
                        <span>Problème de connexion</span>
                        <button 
                          onClick={() => repairConnection(participant.id)}
                          className="repair-connection-btn"
                        >
                          <WifiOff size={16} /> Réparer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {(showChat || showParticipants || isMobileMenuOpen) && (
          <>
            <div className="sidebar-overlay" onClick={() => {
              setShowChat(false);
              setShowParticipants(false);
              setIsMobileMenuOpen(false);
            }}></div>
            <div className={`sidebar ${(isMobileMenuOpen || showChat || showParticipants) ? 'mobile-open' : ''}`}>
              <div className="sidebar-tabs">
                <button 
                  className={`tab ${activeTab === 'chat' ? 'active' : ''}`}
                  onClick={() => { 
                    setActiveTab('chat'); 
                    setShowChat(true); 
                    setShowParticipants(false);
                    const isMobile = window.innerWidth <= 900;
                    if (isMobile) {
                      setIsMobileMenuOpen(true);
                    }
                  }}
                >
                  Chat
                </button>
                <button 
                  className={`tab ${activeTab === 'participants' ? 'active' : ''}`}
                  onClick={() => { 
                    setActiveTab('participants'); 
                    setShowParticipants(true); 
                    setShowChat(false);
                    const isMobile = window.innerWidth <= 900;
                    if (isMobile) {
                      setIsMobileMenuOpen(true);
                    }
                  }}
                >
                  Participants
                </button>
                <button className="close-sidebar-btn" onClick={() => {
                  setShowChat(false);
                  setShowParticipants(false);
                  setIsMobileMenuOpen(false);
                }}>
                  <X size={20} />
                </button>
              </div>

              {activeTab === 'chat' && (
                <div className="chat-container">
                  <div className="messages-list">
                    {chatMessages.map((msg) => (
                      <div key={msg.id} className={`message ${msg.senderId === socketRef.current?.id ? 'own-message' : ''}`}>
                        <div className="message-header">
                          <span className="message-sender">{msg.sender}</span>
                          <span className="message-time">
                            {new Date(msg.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            {msg.isEdited && <span className="edited-badge"> (modifié)</span>}
                          </span>
                        </div>

                        {editingMessageId === msg.id ? (
                          <div className="message-edit">
                            <input
                              type="text"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              className="edit-input"
                              autoFocus
                            />
                            <div className="edit-actions">
                              <button onClick={() => saveEdit(msg.id)} className="save-btn">Enregistrer</button>
                              <button onClick={() => setEditingMessageId(null)} className="cancel-btn">Annuler</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="message-content">
                              <p>{msg.text}</p>
                              
                              {msg.fileUrl && (
                                <div className="message-file">
                                  <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="file-link">
                                    <span className="file-icon">{getFileIcon(msg.fileType)}</span>
                                    <div className="file-info">
                                      <span className="file-name">{msg.fileName}</span>
                                      <span className="file-size">{formatFileSize(msg.fileSize)}</span>
                                    </div>
                                  </a>
                                </div>
                              )}
                            </div>

                            <div className="message-actions">
                              {msg.isPinned && <Pin size={14} className="pinned-icon" title="Message épinglé" />}
                              
                              <div className="reactions">
                                {Object.entries(msg.reactions || {}).map(([emoji, users]) => 
                                  users.length > 0 && (
                                    <button 
                                      key={emoji}
                                      className={`reaction ${users.includes(socketRef.current?.id) ? 'active' : ''}`}
                                      onClick={() => reactToMessage(msg.id, emoji)}
                                      title={`${users.length} réaction(s)`}
                                    >
                                      {emoji} {users.length}
                                    </button>
                                  )
                                )}
                                
                                <button 
                                  className="add-reaction-btn"
                                  onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)}
                                >
                                  <Smile size={14} />
                                </button>
                                
                                {showEmojiPicker === msg.id && (
                                  <div className="emoji-picker">
                                    {emojis.map(emoji => (
                                      <button 
                                        key={emoji}
                                        onClick={() => reactToMessage(msg.id, emoji)}
                                        className="emoji-btn"
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="message-menu-wrapper" ref={el => messageMenuRefs.current[msg.id] = el}>
                                <button 
                                  onClick={() => setShowMessageMenu(showMessageMenu === msg.id ? null : msg.id)}
                                  className="message-menu-btn"
                                >
                                  <MoreVertical size={14} />
                                </button>
                                
                                {showMessageMenu === msg.id && renderMessageMenu(
                                  msg.id, 
                                  msg.senderId === socketRef.current?.id,
                                  msg.isPinned
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    <div ref={chatMessagesEndRef} />
                  </div>

                  <div className="chat-input-container">
                    <div className="chat-input">
                      <input
                        ref={messageInputRef}
                        type="text"
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                          }
                        }}
                        placeholder="Écrivez un message..."
                        className="message-input"
                        autoComplete="off"
                        inputMode="text"
                        enterKeyHint="send"
                      />
                      <button onClick={sendMessage} className="send-btn" disabled={!messageInput.trim()}>
                        <Send size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'participants' && (
                <div className="participants-list">
                  {participants.map((participant) => (
                    <div key={participant.id} className={`participant-item ${connectionProblems[participant.id] ? 'connection-problem' : ''}`}>
                      <div className="participant-avatar">
                        {participant.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="participant-info">
                        <span className="participant-name">{participant.name}</span>
                        {participant.isLocal && <span className="you-badge">Vous</span>}
                        {participant.isCreator && <span className="creator-badge">👑 Créateur</span>}
                        {connectionProblems[participant.id] && (
                          <span className="connection-problem-badge">
                            <WifiOff size={12} /> Problème de connexion
                          </span>
                        )}
                      </div>
                      {isCreator && !participant.isLocal && (
                        <div className="participant-controls">
                          <button
                            onClick={() => {}}
                            className="control-participant-btn"
                            title="Désactiver la caméra"
                          >
                            <Video size={16} />
                          </button>
                          <button
                            onClick={() => {}}
                            className="control-participant-btn"
                            title="Désactiver le micro"
                          >
                            <Mic size={16} />
                          </button>
                          {connectionProblems[participant.id] && (
                            <button
                              onClick={() => repairConnection(participant.id)}
                              className="control-participant-btn repair-btn"
                              title="Réparer la connexion"
                            >
                              <WifiOff size={16} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="controls-bar">
        <div className="controls-group">
          <button onClick={toggleVideo} className={`control-btn ${!isVideoOn ? 'danger' : ''}`} title={isVideoOn ? "Désactiver la caméra" : "Activer la caméra"}>
            {isVideoOn ? <Video size={24} /> : <VideoOff size={24} />}
          </button>
          
          <button onClick={toggleAudio} className={`control-btn ${!isAudioOn ? 'danger' : ''}`} title={isAudioOn ? "Désactiver le micro" : "Activer le micro"}>
            {isAudioOn ? <Mic size={24} /> : <MicOff size={24} />}
          </button>

          <button onClick={toggleScreenShare} className={`control-btn ${isScreenSharing ? 'active' : ''}`} title={isScreenSharing ? "Arrêter le partage d'écran" : "Partager l'écran"}>
            {isScreenSharing ? <MonitorOff size={24} /> : <Monitor size={24} />}
          </button>

          <button onClick={() => { 
            const shouldShow = !showChat;
            setShowChat(shouldShow);
            setActiveTab('chat');
            setShowParticipants(false);
            const isMobile = window.innerWidth <= 900;
            if (isMobile && shouldShow) {
              setIsMobileMenuOpen(true);
            } else if (!shouldShow) {
              setIsMobileMenuOpen(false);
            }
          }} className={`control-btn ${showChat ? 'active' : ''}`} title="Ouvrir le chat">
            <MessageSquare size={24} />
          </button>

          <button onClick={leaveRoom} className="control-btn danger leave-btn" title="Quitter la salle">
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}