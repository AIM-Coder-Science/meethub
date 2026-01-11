import React, { useState, useRef, useEffect } from 'react';
import { Video, VideoOff, Mic, MicOff, Phone, PhoneOff, MessageSquare, Users, Monitor, Copy, Check, MonitorOff, Send, Image as ImageIcon, Paperclip, MoreVertical, Edit2, Trash2, Pin, Heart, ThumbsUp, ThumbsDown, Smile, X, Menu } from 'lucide-react';
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
  const [screenStreams, setScreenStreams] = useState({});
  const [copied, setCopied] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Déconnecté');
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false);
  const [iceServers, setIceServers] = useState([]);
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
  const mediaPlayerRef = useRef(null);
  const mediaSyncThreshold = 2000;
  const isReceivingRemoteUpdate = useRef(false);
  const [iceConnectionAttempts, setIceConnectionAttempts] = useState({});
  
  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef({});
  const screenPeersRef = useRef({});
  const remoteVideosRef = useRef({});
  const screenVideosRef = useRef({});
  const chatMessagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const messageMenuRefs = useRef({});
  const messageInputRef = useRef(null);

  // QUEUE ICE CANDIDATES
  const pendingIceCandidatesRef = useRef({});
  const remoteDescriptionsSetRef = useRef({});

  // ============ NOUVEAUX REFS POUR PERFECT NEGOTIATION ============
  const isNegotiatingRef = useRef({}); // { peerId: true/false }
  const makingOfferRef = useRef({}); // { peerId: true/false }
  const ignoreOfferRef = useRef({}); // { peerId: true/false }
  const isPolitePeerRef = useRef({}); // { peerId: true/false }
  // ================================================================

  // ============ ICE RESTART STRATEGY (CRITICAL FIX) ============
  // Track ICE restart state to prevent infinite loops and multiple restarts
  const iceRestartInProgressRef = useRef({}); // { peerId: true/false }
  const iceRestartTimestampRef = useRef({}); // { peerId: timestamp }
  const iceRestartCountRef = useRef({}); // { peerId: count } (max 1)
  const ICE_RESTART_COOLDOWN = 5000; // 5 second cooldown
  const ICE_RESTART_MAX_ATTEMPTS = 1; // Only restart ICE once per peer
  // ============================================================

  // ============ CONNECTION LOSS TRACKING (Production UI) ============
  const connectionLossRef = useRef({}); // { peerId: true/false }
  const [connectionLossState, setConnectionLossState] = useState({}); // Trigger UI updates
  // ==================================================================

  const emojis = ['❤️', '👍', '👎', '😂', '😮', '😢', '🎉'];

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

  const scrollToBottom = () => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  useEffect(() => {
    if (showChat && activeTab === 'chat' && messageInputRef.current) {
      const timer = setTimeout(() => {
        messageInputRef.current?.focus();
        if (window.innerWidth <= 900) {
          setTimeout(() => {
            messageInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 300);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showChat, activeTab]);

  useEffect(() => {
    const fetchTurnCredentials = async () => {
      if (isFetchingTurn) return;
      
      setIsFetchingTurn(true);
      try {
        console.log('🔄 Récupération des credentials TURN...');
        
        const response = await fetch(`${SOCKET_SERVER_URL}/api/turn-credentials`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          mode: 'cors'
        });
        
        if (!response.ok) {
          throw new Error(`Serveur indisponible: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📡 Données TURN reçues:', data);
        
        if (data.iceServers && Array.isArray(data.iceServers)) {
          // ============ OPTIMIZE ICE SERVERS (Production-Grade) ============
          // Filter Twilio servers: keep only essential ones to speed up ICE checking
          // 16 servers = too slow. Target: 3-5 servers max.
          
          const optimizedTurnServers = data.iceServers
            .filter(server => {
              // Keep Twilio global STUN
              if (server.urls?.includes('stun:global.stun.twilio.com')) return true;
              // Keep TURN servers with UDP transport (faster than TCP)
              if (server.urls?.includes('turn:') && server.urls?.includes('transport=udp')) return true;
              return false;
            })
            .slice(0, 3); // Max 3 TURN servers
          
          console.log(`[ICE SERVERS] Optimisation: ${data.iceServers.length} → ${optimizedTurnServers.length} serveurs`);
          
          const config = {
            iceServers: [
              // Prioritize Google/Voipbuster STUN (fast + reliable)
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              // Add optimized Twilio TURN servers
              ...optimizedTurnServers
            ],
            iceTransportPolicy: 'all',
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
          };
          
          setIceConfig(config);
          console.log('✅ ICE Config optimisée: STUN x2 + TURN x' + optimizedTurnServers.length);
          
          setIceServers(optimizedTurnServers);
        } else {
          console.warn('⚠️ Format de données TURN invalide, utilisation des STUN par défaut');
          setIceConfig(getDefaultIceConfig());
        }
      } catch (error) {
        console.error('❌ Erreur récupération TURN credentials:', error);
        setIceConfig(getDefaultIceConfig());
      } finally {
        setIsFetchingTurn(false);
      }
    };
    
    fetchTurnCredentials();
    
    function getDefaultIceConfig() {
      return {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun.voipbuster.com:3478' }
        ],
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      };
    }
  }, []);

  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      Object.values(peersRef.current).forEach(peer => {
        if (peer && typeof peer.close === 'function') {
          peer.close();
        }
      });
      Object.values(screenPeersRef.current).forEach(peer => {
        if (peer && typeof peer.close === 'function') {
          peer.close();
        }
      });
    };
  }, []);

  const addPendingIceCandidate = (peerId, candidate) => {
    if (!pendingIceCandidatesRef.current[peerId]) {
      pendingIceCandidatesRef.current[peerId] = [];
    }
    pendingIceCandidatesRef.current[peerId].push(candidate);
    console.log(`📥 ICE candidate mis en queue pour ${peerId}`);
  };

  const flushPendingIceCandidates = async (peerId, peer) => {
    const pending = pendingIceCandidatesRef.current[peerId];
    if (!pending || pending.length === 0 || !peer) return;

    console.log(`🔄 Évacuation des ${pending.length} ICE candidates pour ${peerId}`);
    
    for (const candidate of pending) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`✅ ICE candidate évacué pour ${peerId}`);
      } catch (error) {
        console.warn(`⚠️ Erreur évacuation ICE candidate pour ${peerId}:`, error.message);
      }
    }
    
    pendingIceCandidatesRef.current[peerId] = [];
  };

  const cleanupPeerData = (peerId) => {
    if (peersRef.current[peerId]) {
      try {
        peersRef.current[peerId].close();
      } catch (err) {
        console.warn(`⚠️ Erreur fermeture peer ${peerId}:`, err);
      }
      delete peersRef.current[peerId];
    }
    
    delete pendingIceCandidatesRef.current[peerId];
    delete remoteDescriptionsSetRef.current[peerId];
    delete isNegotiatingRef.current[peerId];
    delete makingOfferRef.current[peerId];
    delete ignoreOfferRef.current[peerId];
    delete isPolitePeerRef.current[peerId];
    
    // Cleanup ICE restart tracking
    delete iceRestartInProgressRef.current[peerId];
    delete iceRestartTimestampRef.current[peerId];
    delete iceRestartCountRef.current[peerId];
    
    // Cleanup connection loss tracking
    delete connectionLossRef.current[peerId];
    setConnectionLossState(prev => {
      const updated = { ...prev };
      delete updated[peerId];
      return updated;
    });
    
    setRemoteStreams(prev => {
      const updated = { ...prev };
      delete updated[peerId];
      return updated;
    });
    
    setIceConnectionAttempts(prev => {
      const updated = { ...prev };
      delete updated[peerId];
      return updated;
    });
  };

  // ============ PERFECT NEGOTIATION HELPER ============
  const canNegotiate = (peer, peerId) => {
    if (!peer) return false;
    if (peer.signalingState !== 'stable') {
      console.log(`⚠️ Cannot negotiate ${peerId}: signalingState = ${peer.signalingState}`);
      return false;
    }
    if (isNegotiatingRef.current[peerId]) {
      console.log(`⚠️ Cannot negotiate ${peerId}: already negotiating`);
      return false;
    }
    return true;
  };
  // ====================================================

  useEffect(() => {
    console.log('🔌 Initialisation Socket.io...');
    
    // FIX: Prioritize polling on Render (WebSocket often fails initially)
    // Polling is more reliable for NAT traversal on Render infrastructure
    socketRef.current = io(SOCKET_SERVER_URL, {
      transports: ['polling', 'websocket'], // Try polling first (more reliable on Render)
      reconnection: true,
      reconnectionAttempts: 10, // Increase attempts for Render
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000, // Exponential backoff
      timeout: 20000, // Increase timeout for slow connections
      forceNew: false
    });

    socketRef.current.on('connect', () => {
      console.log('✅ Connecté au serveur');
      setConnectionStatus('Connecté');
    });

    socketRef.current.on('disconnect', () => {
      console.log('❌ Déconnecté du serveur');
      setConnectionStatus('Déconnecté');
      setHasJoinedRoom(false);
    });

    socketRef.current.on('existing-users', (users) => {
      console.log('👥 Utilisateurs existants:', users);
      users.forEach(user => {
        addParticipant(user.id, user.name);
        createPeerConnection(user.id, true);
      });
    });

    socketRef.current.on('user-joined', (user) => {
      console.log('👤 Nouvel utilisateur:', user);
      addParticipant(user.id, user.name, user.isCreator);
      createPeerConnection(user.id, false);
    });

    socketRef.current.on('join-room-confirmation', ({ roomId, userName, success, isCreator: creatorStatus, timestamp }) => {
      if (success) {
        setIsCreator(creatorStatus || false);
        console.log(`✅ Rejoint la salle ${roomId}, créateur: ${creatorStatus || false}`);
        
        if (socketRef.current) {
          socketRef.current.emit('get-media-state', { roomId });
        }
      }
    });

    socketRef.current.on('media-action', ({ action, type, url, currentTime, pageNumber, lastUpdatedServerTime, isPlaying }) => {
      console.log('🎬 Action média reçue:', action, type);
      
      isReceivingRemoteUpdate.current = true;
      
      if (action === 'load') {
        setMediaState({
          type,
          url,
          isPlaying: false,
          currentTime: 0,
          lastUpdatedServerTime: lastUpdatedServerTime || Date.now(),
          pageNumber: type === 'pdf' ? (pageNumber || 1) : null
        });
        setShowMediaPlayer(true);
      } else if (action === 'play' || action === 'pause' || action === 'seek') {
        if (mediaPlayerRef.current && mediaState) {
          const player = mediaPlayerRef.current;
          const timeDiff = Date.now() - (lastUpdatedServerTime || Date.now());
          const adjustedTime = currentTime + (timeDiff / 1000);
          
          if (Math.abs(player.currentTime - adjustedTime) > mediaSyncThreshold / 1000) {
            player.currentTime = adjustedTime;
          }
          
          if (action === 'play' && !isPlaying) {
            player.play().catch(err => console.error('Erreur play:', err));
          } else if (action === 'pause' || action === 'seek') {
            player.pause();
          }
          
          setMediaState(prev => ({
            ...prev,
            isPlaying: action === 'play',
            currentTime: adjustedTime,
            lastUpdatedServerTime: lastUpdatedServerTime || Date.now()
          }));
        }
      } else if (action === 'page-change' && type === 'pdf') {
        setMediaState(prev => ({
          ...prev,
          pageNumber: pageNumber || 1,
          lastUpdatedServerTime: lastUpdatedServerTime || Date.now()
        }));
        
        if (mediaPlayerRef.current && mediaPlayerRef.current.src) {
          const iframe = document.querySelector('.pdf-viewer');
          if (iframe) {
            iframe.src = `${mediaState?.url || ''}#page=${pageNumber || 1}`;
          }
        }
      } else if (action === 'stop') {
        setMediaState(null);
        setShowMediaPlayer(false);
        if (mediaPlayerRef.current) {
          mediaPlayerRef.current.pause();
          mediaPlayerRef.current.src = '';
        }
      }
      
      setTimeout(() => {
        isReceivingRemoteUpdate.current = false;
      }, 100);
    });

    socketRef.current.on('media-state-update', (state) => {
      console.log('🎬 État média initial reçu:', state);
      if (!mediaState && state) {
        setMediaState(state);
        setShowMediaPlayer(true);
      }
    });

    socketRef.current.on('remote-media-control', ({ action, value, controlledBy }) => {
      console.log(`👑 Contrôle distant: ${action} = ${value} par ${controlledBy}`);
      
      if (action === 'toggle-video' || action === 'mute-video') {
        if (localStreamRef.current) {
          const videoTrack = localStreamRef.current.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.enabled = value !== false;
            setIsVideoOn(videoTrack.enabled);
          }
        }
      } else if (action === 'toggle-audio' || action === 'mute-audio') {
        if (localStreamRef.current) {
          const audioTrack = localStreamRef.current.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.enabled = value !== false;
            setIsAudioOn(audioTrack.enabled);
          }
        }
      }
      
      setNotification({
        message: `${controlledBy} a ${action === 'toggle-video' || action === 'mute-video' ? (value ? 'activé' : 'désactivé') : (value ? 'activé' : 'désactivé')} votre ${action.includes('video') ? 'caméra' : 'micro'}`,
        type: 'info',
        timestamp: Date.now()
      });
      
      setTimeout(() => setNotification(null), 3000);
    });

    socketRef.current.on('user-left', (user) => {
      console.log('👋 Utilisateur parti:', user);
      removeParticipant(user.id);
      cleanupPeerData(user.id);
    });

    // ============ PERFECT NEGOTIATION PATTERN ============
    socketRef.current.on('offer', async ({ from, offer }) => {
      console.log('[PERFNEG] 📨 Offre reçue de:', from);
      
      let peer = peersRef.current[from];
      if (!peer) {
        console.log(`[PERFNEG] 🔗 Création peer ${from} pour traiter l'offre`);
        peer = await createPeerConnection(from, false);
        if (!peer) return;
      }
      
      try {
        // PERFECT NEGOTIATION: Collision detection and handling
        // Collision occurs when: signalingState !== 'stable' OR we're making an offer
        // Strategy: Impolite peer (initiator) ignores offer, Polite peer (receiver) accepts it
        
        const isPolite = isPolitePeerRef.current[from] || false;
        const offerCollision = peer.signalingState !== 'stable' || makingOfferRef.current[from];
        
        ignoreOfferRef.current[from] = !isPolite && offerCollision;
        
        if (ignoreOfferRef.current[from]) {
          console.log(`[PERFNEG] ⚠️ Offre IGNORÉE (collision détectée, nous sommes impolite): ${from}`);
          console.log(`   signalingState="${peer.signalingState}", makingOffer=${makingOfferRef.current[from]}`);
          console.log(`   Nous attendrons notre answer à la place de cette offre`);
          return;
        }
        
        if (offerCollision) {
          console.log(`[PERFNEG] ✅ Collision détectée mais nous sommes POLITE - acceptons l'offre distante`);
        }
        
        remoteDescriptionsSetRef.current[from] = false;
        
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`[PERFNEG] ✅ remoteDescription défini pour ${from}`);
        remoteDescriptionsSetRef.current[from] = true;
        
        await flushPendingIceCandidates(from, peer);
        
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        
        socketRef.current.emit('answer', { to: from, answer });
        console.log(`[PERFNEG] 📤 Answer envoyé à ${from}`);
        
      } catch (error) {
        console.error(`❌ Erreur traitement offer de ${from}:`, error);
        // Note: We don't recreate peer. ICE restart will handle recovery if needed.
      }
    });

    socketRef.current.on('answer', async ({ from, answer }) => {
      console.log('[PERFNEG] 📨 Réponse reçue de:', from);

      const peer = peersRef.current[from];
      if (!peer) {
        console.warn(`[PERFNEG] ⚠️ Aucun peer trouvé pour ${from}, réponse ignorée`);
        return;
      }

      // ============ PERFECT NEGOTIATION: ANSWER ACCEPTANCE ============
      // RULE: Only accept answer when signalingState === 'have-local-offer'
      // This prevents InvalidStateError, double-answer, and collision issues
      const signalingState = peer.signalingState;
      
      if (signalingState !== 'have-local-offer') {
        console.warn(`[PERFNEG] ⚠️ Answer IGNORÉ - signalingState: "${signalingState}" (attendu: "have-local-offer")`);
        console.warn(`[PERFNEG]    Explication: Un answer ne peut être accepté que si nous avons envoyé une offer`);
        console.warn(`[PERFNEG]    État indique potentiellement: double-answer, collision, ou offre en attente`);
        return;
      }
      // ==============================================================

      try {
        remoteDescriptionsSetRef.current[from] = false;

        await peer.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`✅ Answer accepté - remoteDescription défini pour ${from}`);
        remoteDescriptionsSetRef.current[from] = true;

        await flushPendingIceCandidates(from, peer);

      } catch (error) {
        console.error(`❌ Erreur traitement answer de ${from}:`, error);
        // Note: We don't recreate peer. ICE restart will handle recovery if needed.
      }
    });
    // ====================================================

    socketRef.current.on('ice-candidate', async ({ from, candidate }) => {
      console.log('🧊 ICE CANDIDATE reçu de:', from, candidate?.type);
      
      const peer = peersRef.current[from];
      if (!peer) {
        console.warn(`⚠️ Aucun peer trouvé pour ${from}, candidat ignoré`);
        return;
      }
      
      const isRemoteDescriptionSet = remoteDescriptionsSetRef.current[from] || peer.remoteDescription;
      
      if (!isRemoteDescriptionSet) {
        console.log(`📥 ICE candidate mis en attente pour ${from} (remoteDescription non défini)`);
        addPendingIceCandidate(from, candidate);
        return;
      }
      
      if (candidate) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(`✅ ICE candidate ajouté directement pour ${from}`);
        } catch (error) {
          if (error.toString().includes('Unknown ufrag') || 
              error.toString().includes('The remote description was null') ||
              error.code === 400) {
            console.warn(`⚠️ Candidat ICE périmé pour ${from}, ignoré:`, error.message);
          } else {
            console.error(`❌ Erreur ajout ICE candidate pour ${from}:`, error);
          }
        }
      }
    });

    socketRef.current.on('user-screen-share-start', ({ userId }) => {
      console.log(`📺 Partage d'écran démarré par ${userId}`);
      createScreenPeerConnection(userId, false);
    });

    socketRef.current.on('user-screen-share-stop', ({ userId }) => {
      console.log(`📺 Partage d'écran arrêté par ${userId}`);
      if (screenPeersRef.current[userId]) {
        try {
          screenPeersRef.current[userId].close();
        } catch (err) {
          console.warn(`⚠️ Erreur fermeture screen peer ${userId}:`, err);
        }
        delete screenPeersRef.current[userId];
      }
      setScreenStreams(prev => {
        const updated = { ...prev };
        delete updated[userId];
        return updated;
      });
    });

    socketRef.current.on('screen-offer', async ({ from, offer }) => {
      console.log('📺 OFFRE ÉCRAN reçue de:', from);
      let peer = screenPeersRef.current[from];
      if (!peer) {
        peer = await createScreenPeerConnection(from, false);
      }
      if (peer) {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socketRef.current.emit('screen-answer', { to: from, answer });
        } catch (error) {
          console.error('❌ Erreur traitement screen offer:', error);
        }
      }
    });

    socketRef.current.on('screen-answer', async ({ from, answer }) => {
      console.log('📺 RÉPONSE ÉCRAN reçue de:', from);
      const peer = screenPeersRef.current[from];
      if (peer) {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
          console.error('❌ Erreur traitement screen answer:', error);
        }
      }
    });

    socketRef.current.on('screen-ice-candidate', async ({ from, candidate }) => {
      console.log('🧊 ICE ÉCRAN reçu de:', from);
      const peer = screenPeersRef.current[from];
      if (peer && peer.remoteDescription) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('❌ Erreur ajout screen ICE candidate:', error);
        }
      }
    });

    socketRef.current.on('chat-message', (message) => {
      console.log('💬 Nouveau message reçu:', message);
      if (message && message.id) {
        setChatMessages(prev => {
          const exists = prev.find(m => m.id === message.id);
          if (exists) {
            console.log('⚠️ Message déjà présent, ignoré:', message.id);
            return prev;
          }
          console.log('✅ Message ajouté au chat');
          return [...prev, message];
        });
      } else {
        console.warn('⚠️ Message invalide reçu:', message);
      }
    });

    socketRef.current.on('chat-history', (messages) => {
      console.log('📜 Historique chat:', messages.length, 'messages');
      setChatMessages(messages);
    });

    socketRef.current.on('pinned-messages', (messages) => {
      console.log('📌 Messages épinglés:', messages.length);
      setPinnedMessages(messages);
    });

    socketRef.current.on('message-edited', ({ messageId, newText }) => {
      console.log('✏️ Message édité:', messageId);
      setChatMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, text: newText, isEdited: true } : msg
      ));
    });

    socketRef.current.on('message-deleted', ({ messageId }) => {
      console.log('🗑️ Message supprimé:', messageId);
      setChatMessages(prev => prev.filter(msg => msg.id !== messageId));
    });

    socketRef.current.on('message-reacted', ({ messageId, reactions }) => {
      console.log('😀 Réaction ajoutée:', messageId);
      setChatMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, reactions } : msg
      ));
    });

    socketRef.current.on('message-pinned', ({ messageId, isPinned, pinnedMessages }) => {
      console.log('📌 Message épinglé:', messageId, isPinned);
      setChatMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, isPinned } : msg
      ));
      setPinnedMessages(pinnedMessages);
    });

    socketRef.current.on('user-video-toggle', ({ userId, userName, isVideoOn }) => {
      console.log('🎥 Vidéo toggle:', userId, userName, isVideoOn);
      
      setUserVideoStatus(prev => ({ ...prev, [userId]: isVideoOn }));
      
      if (userName) {
        setNotification({
          message: `${userName} a ${isVideoOn ? 'activé' : 'coupé'} sa caméra`,
          type: 'info',
          timestamp: Date.now()
        });
        
        setTimeout(() => {
          setNotification(null);
        }, 3000);
      }
      
      setRemoteStreams(prev => {
        const stream = prev[userId];
        if (stream) {
          stream.getVideoTracks().forEach(track => {
            track.enabled = isVideoOn;
          });
          
          setTimeout(() => {
            const videoElement = remoteVideosRef.current[userId];
            if (videoElement) {
              videoElement.srcObject = stream;
              videoElement.load();
            }
          }, 50);
        }
        return prev;
      });
    });

    socketRef.current.on('user-audio-toggle', ({ userId, isAudioOn }) => {
      console.log('🎤 Audio toggle:', userId, isAudioOn);
    });

    return () => {
      if (socketRef.current) {
        console.log('🔌 Nettoyage socket...');
        socketRef.current.disconnect();
      }
    };
  }, []);

  // ============ CRÉATION PEER CONNECTION AVEC PERFECT NEGOTIATION ============
  const createPeerConnection = async (userId, isInitiator) => {
    try {
      console.log(`🔗 Création peer ${userId} (initiateur: ${isInitiator})`);
      
      cleanupPeerData(userId);
      
      const configuration = iceConfig || getDefaultIceConfig();
      
      console.log('⚙️ Configuration ICE utilisée:', configuration.iceServers);
      
      const peer = new RTCPeerConnection(configuration);
      peersRef.current[userId] = peer;
      
      // Initialiser perfect negotiation
      pendingIceCandidatesRef.current[userId] = [];
      remoteDescriptionsSetRef.current[userId] = false;
      isNegotiatingRef.current[userId] = false;
      makingOfferRef.current[userId] = false;
      ignoreOfferRef.current[userId] = false;
      isPolitePeerRef.current[userId] = !isInitiator; // Initiator = impolite, receiver = polite
      
      // Initialize ICE restart tracking
      iceRestartInProgressRef.current[userId] = false;
      iceRestartCountRef.current[userId] = 0;
      iceRestartTimestampRef.current[userId] = 0;

      // ============ PERFECT NEGOTIATION: onnegotiationneeded ============
      peer.onnegotiationneeded = async () => {
        console.log(`🔄 Negotiation needed pour ${userId}`);
        
        if (!canNegotiate(peer, userId)) {
          console.log(`⚠️ Negotiation refusée pour ${userId}`);
          return;
        }
        
        try {
          isNegotiatingRef.current[userId] = true;
          makingOfferRef.current[userId] = true;
          
          const offer = await peer.createOffer();
          
          // Double-check signalingState avant setLocalDescription
          if (peer.signalingState !== 'stable') {
            console.log(`⚠️ signalingState non stable, abandon offer pour ${userId}`);
            return;
          }
          
          await peer.setLocalDescription(offer);
          
          socketRef.current.emit('offer', {
            to: userId,
            offer: peer.localDescription
          });
          
          console.log(`✅ Offre créée et envoyée à ${userId}`);
        } catch (error) {
          console.error(`❌ Erreur création offer pour ${userId}:`, error);
        } finally {
          makingOfferRef.current[userId] = false;
          isNegotiatingRef.current[userId] = false;
        }
      };
      // ==================================================================

      peer.oniceconnectionstatechange = () => {
        const state = peer.iceConnectionState;
        console.log(`🔌 État ICE ${userId}:`, state);
        
        // ============ ICE RESTART STRATEGY (CRITICAL) ============
        // Trigger ICE restart on "disconnected" (not "failed")
        // Max 1 restart attempt per peer with 5 second cooldown
        if (state === 'disconnected') {
          console.warn(`⚠️ ICE disconnected (transient) pour ${userId}`);
          
          // Check if ICE restart already in progress or already attempted
          const isInProgress = iceRestartInProgressRef.current[userId];
          const restartCount = iceRestartCountRef.current[userId] || 0;
          const lastRestartTime = iceRestartTimestampRef.current[userId] || 0;
          const timeSinceLastRestart = Date.now() - lastRestartTime;
          
          // Only trigger restart if:
          // 1. Not already in progress
          // 2. Haven't reached max attempts
          // 3. Cooldown period has passed
          // 4. Peer is in stable signaling state
          // 5. Not already making an offer
          if (!isInProgress && 
              restartCount < ICE_RESTART_MAX_ATTEMPTS && 
              timeSinceLastRestart > ICE_RESTART_COOLDOWN &&
              peer.signalingState === 'stable' &&
              !makingOfferRef.current[userId]) {
            
            console.log(`[ICE RESTART] 🔄 Déclenchement pour ${userId} (tentative ${restartCount + 1}/${ICE_RESTART_MAX_ATTEMPTS})`);
            
            iceRestartInProgressRef.current[userId] = true;
            iceRestartCountRef.current[userId] = restartCount + 1;
            iceRestartTimestampRef.current[userId] = Date.now();
            
            setTimeout(async () => {
              try {
                if (!peer || peer.iceConnectionState !== 'disconnected') {
                  console.log(`[ICE RESTART] ⚠️ Annulé pour ${userId}: state changed to ${peer?.iceConnectionState || 'peer closed'}`);
                  iceRestartInProgressRef.current[userId] = false;
                  return;
                }
                
                // Only initiator creates offer with ICE restart
                if (isInitiator && peer.signalingState === 'stable') {
                  isNegotiatingRef.current[userId] = true;
                  makingOfferRef.current[userId] = true;
                  
                  const offer = await peer.createOffer({ iceRestart: true });
                  await peer.setLocalDescription(offer);
                  
                  socketRef.current.emit('offer', {
                    to: userId,
                    offer: peer.localDescription
                  });
                  
                  console.log(`[ICE RESTART] ✅ Offer envoyé à ${userId} (timestamp: ${new Date().toISOString()})`);
                } else {
                  console.log(`[ICE RESTART] ⚠️ Non-initiator ${userId} attente d'une nouvelle offer`);
                }
              } catch (error) {
                console.error(`[ICE RESTART] ❌ Erreur pour ${userId}:`, error.message);
              } finally {
                iceRestartInProgressRef.current[userId] = false;
                isNegotiatingRef.current[userId] = false;
                makingOfferRef.current[userId] = false;
              }
            }, 500); // Short delay before restart
          } else if (isInProgress) {
            console.log(`[ICE RESTART] ℹ️ Déjà en cours pour ${userId}`);
          } else if (restartCount >= ICE_RESTART_MAX_ATTEMPTS) {
            console.warn(`[ICE RESTART] ⚠️ Max attempts atteint pour ${userId}. Pas de restart supplémentaire.`);
          } else if (timeSinceLastRestart <= ICE_RESTART_COOLDOWN) {
            console.warn(`[ICE RESTART] ⚠️ En cooldown pour ${userId} (${Math.round((ICE_RESTART_COOLDOWN - timeSinceLastRestart) / 1000)}s restantes)`);
          }
        } else if (state === 'failed') {
          // ===== ICE FAILED: Do NOT restart, show error UI =====
          console.error(`❌ ICE failed définitivement pour ${userId}`);
          
          // Mark connection as lost for UI
          connectionLossRef.current[userId] = true;
          setConnectionLossState(prev => ({ ...prev, [userId]: true }));
          
          setNotification({
            message: `Connexion perdue avec ${participants.find(p => p.id === userId)?.name || 'un participant'}. Essayez de relancer la vidéo.`,
            type: 'error',
            timestamp: Date.now()
          });
          
          // NOTE: No peer recreation. No ICE restart after "failed".
          // User must manually retry or reconnect.
        } else if (state === 'connected' || state === 'completed') {
          console.log(`✅ Connexion ICE établie avec ${userId}`);
          // Reset ICE restart tracking on successful connection
          iceRestartCountRef.current[userId] = 0;
          iceRestartTimestampRef.current[userId] = 0;
          // Clear connection loss marker
          connectionLossRef.current[userId] = false;
          setConnectionLossState(prev => ({ ...prev, [userId]: false }));
        } else if (state === 'new' || state === 'checking') {
          console.log(`🔍 ICE checking pour ${userId}...`);
        }
      };

      // CRITICAL FIX: DO NOT recreate peer on connectionState='failed'
      // Use ICE restart instead (handled in oniceconnectionstatechange)
      peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        console.log(`🔌 État connexion ${userId}:`, state);
        
        if (state === 'failed') {
          // Connection failed - ICE restart is triggered in oniceconnectionstatechange
          console.error(`❌ Connexion failed pour ${userId} - ICE restart sera tenté...`);
          // NOTE: Peer is NOT recreated. ICE restart is the recovery mechanism.
        } else if (state === 'disconnected') {
          console.warn(`⚠️ Connexion disconnected (transient) pour ${userId}. WebRTC tente une reconnexion...`);
        } else if (state === 'connected') {
          console.log(`✅ Connexion établie avec ${userId}`);
        }
      };

      peer.onsignalingstatechange = () => {
        console.log(`📡 État signaling ${userId}:`, peer.signalingState);
        if (peer.signalingState === 'stable') {
          isNegotiatingRef.current[userId] = false;
          makingOfferRef.current[userId] = false;
        }
      };

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          console.log(`🎯 Ajout track ${track.kind} (enabled: ${track.enabled}) à peer ${userId}`);
          try {
            const existingSenders = peer.getSenders();
            const trackAlreadyExists = existingSenders.some(sender => 
              sender.track && sender.track.kind === track.kind
            );
            
            if (!trackAlreadyExists) {
              peer.addTrack(track, localStreamRef.current);
              console.log(`✅ Track ${track.kind} ajouté à peer ${userId}`);
            } else {
              console.log(`ℹ️ Track ${track.kind} déjà présent dans peer ${userId}`);
            }
          } catch (error) {
            console.error(`❌ Erreur ajout track ${track.kind} à peer ${userId}:`, error);
          }
        });
      }

      peer.ontrack = (event) => {
        console.log(`📹 Track reçu de ${userId}:`, event.track?.kind, event.track?.enabled);
        
        if (!event.track) {
          console.warn(`⚠️ Aucun track dans l'event pour ${userId}`);
          return;
        }
        
        const stream = event.streams && event.streams.length > 0 ? event.streams[0] : null;
        
        setRemoteStreams(prev => {
          const existing = prev[userId];
          
          if (existing) {
            const existingTrack = existing.getTracks().find(t => t.id === event.track.id);
            if (!existingTrack) {
              existing.addTrack(event.track);
              console.log(`➕ Track ${event.track.kind} ajouté au stream de ${userId}`);
            } else {
              existingTrack.enabled = event.track.enabled;
              console.log(`🔄 Track ${event.track.kind} mis à jour pour ${userId}`);
            }
            
            setTimeout(() => {
              const videoElement = remoteVideosRef.current[userId];
              if (videoElement) {
                videoElement.srcObject = existing;
              }
            }, 100);
            
            return { ...prev, [userId]: existing };
          } else {
            const newStream = stream || new MediaStream();
            if (!stream && event.track) {
              newStream.addTrack(event.track);
            }
            
            console.log(`✅ Nouveau stream pour ${userId}, tracks:`, newStream.getTracks().length);
            
            setTimeout(() => {
              const videoElement = remoteVideosRef.current[userId];
              if (videoElement) {
                videoElement.srcObject = newStream;
              }
            }, 100);
            
            return { ...prev, [userId]: newStream };
          }
        });
      };

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`🧊 ICE candidate généré pour ${userId}`);
          socketRef.current.emit('ice-candidate', {
            to: userId,
            candidate: event.candidate
          });
        } else {
          console.log(`✅ Fin génération ICE candidates pour ${userId}`);
        }
      };

      peer.onicecandidateerror = (event) => {
        console.error(`❌ Erreur ICE candidate pour ${userId}:`, event.errorCode, event.errorText);
      };

      if (isInitiator) {
        try {
          isNegotiatingRef.current[userId] = true;
          makingOfferRef.current[userId] = true;
          
          const offerOptions = {
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          };
          
          const offer = await peer.createOffer(offerOptions);
          console.log(`📤 OFFRE créée pour ${userId}`);
          
          await peer.setLocalDescription(offer);
          
          socketRef.current.emit('offer', {
            to: userId,
            offer: peer.localDescription
          });
        } catch (error) {
          console.error('❌ Erreur création offer:', error);
        } finally {
          makingOfferRef.current[userId] = false;
          isNegotiatingRef.current[userId] = false;
        }
      }

      return peer;
    } catch (error) {
      console.error('❌ Erreur création peer:', error);
      cleanupPeerData(userId);
      return null;
    }
  };

  const getDefaultIceConfig = () => {
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };
  };

  const createScreenPeerConnection = async (userId, isInitiator) => {
    try {
      if (screenPeersRef.current[userId]) {
        console.log(`🧹 Nettoyage ancien screen peer ${userId}`);
        try {
          screenPeersRef.current[userId].close();
        } catch (err) {
          console.warn(`⚠️ Erreur fermeture screen peer ${userId}:`, err);
        }
        delete screenPeersRef.current[userId];
      }
      
      const configuration = iceConfig || getDefaultIceConfig();
      
      const peer = new RTCPeerConnection(configuration);
      screenPeersRef.current[userId] = peer;

      peer.oniceconnectionstatechange = () => {
        console.log(`🔌 État ICE (écran) ${userId}:`, peer.iceConnectionState);
      };

      peer.onconnectionstatechange = () => {
        console.log(`🔌 État connexion (écran) ${userId}:`, peer.connectionState);
      };

      if (isInitiator && screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => {
          peer.addTrack(track, screenStreamRef.current);
        });
      }

      peer.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream) {
          console.log(`📺 Stream d'écran reçu de ${userId}`);
          setScreenStreams(prev => ({ ...prev, [userId]: stream }));
          setTimeout(() => {
            const videoElement = screenVideosRef.current[userId];
            if (videoElement && stream) {
              videoElement.srcObject = stream;
            }
          }, 100);
        }
      };

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current.emit('screen-ice-candidate', {
            to: userId,
            candidate: event.candidate
          });
        }
      };

      if (isInitiator) {
        const offer = await peer.createOffer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: true
        });
        await peer.setLocalDescription(offer);
        socketRef.current.emit('screen-offer', {
          to: userId,
          offer: peer.localDescription
        });
      }

      return peer;
    } catch (error) {
      console.error('❌ Erreur création screen peer:', error);
      return null;
    }
  };

  const addParticipant = (id, name, isCreator = false) => {
    setParticipants(prev => {
      if (prev.find(p => p.id === id)) return prev;
      console.log(`👤 Participant ajouté: ${name} (${id}), créateur: ${isCreator}`);
      return [...prev, { id, name, isLocal: false, isCreator }];
    });
  };

  const removeParticipant = (id) => {
    console.log(`👤 Participant retiré: ${id}`);
    setParticipants(prev => prev.filter(p => p.id !== id));
  };

  const startLocalStream = async () => {
    try {
      console.log('🎥 Démarrage du stream local...');
      
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
      
      console.log('✅ Stream local obtenu avec succès');
      console.log('   Tracks vidéo:', stream.getVideoTracks().length);
      console.log('   Tracks audio:', stream.getAudioTracks().length);
      
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log('🎬 Vidéo locale attachée');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Erreur accès média:', error);
      let errorMessage = 'Impossible d\'accéder à la caméra/micro.';
      
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Permission refusée pour la caméra/micro. Veuillez autoriser l\'accès.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'Aucune caméra/micro trouvé.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'La caméra/micro est déjà utilisé par une autre application.';
      }
      
      alert(errorMessage);
      return false;
    }
  };

  const joinRoom = async () => {
    if (!userName.trim() || !roomId.trim()) {
      alert('Veuillez entrer votre nom et un ID de salle');
      return;
    }

    console.log(`🚀 Tentative de rejoindre la salle ${roomId}...`);
    const success = await startLocalStream();
    
    if (success) {
      setIsInRoom(true);
      setParticipants([{ id: socketRef.current?.id || 'local', name: userName, isLocal: true }]);
      
      if (!iceConfig && isFetchingTurn) {
        console.log('⏳ En attente de la configuration ICE...');
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      setTimeout(() => {
        socketRef.current.emit('join-room', { roomId, userName });
        setHasJoinedRoom(true);
        console.log(`✅ Connecté à la salle ${roomId} en tant que ${userName}`);
      }, 500);
    }
  };

  const leaveRoom = () => {
    console.log('🚪 Quitter la salle...');
    
    [localStreamRef.current, screenStreamRef.current].forEach(stream => {
      if (stream) {
        stream.getTracks().forEach(track => {
          track.stop();
          console.log(`🛑 Track ${track.kind} arrêté`);
        });
      }
    });
    
    Object.keys(peersRef.current).forEach(peerId => {
      cleanupPeerData(peerId);
    });
    
    Object.entries(screenPeersRef.current).forEach(([id, peer]) => {
      if (peer) {
        try {
          peer.close();
          console.log(`🔒 Screen peer ${id} fermé`);
        } catch (err) {
          console.warn(`⚠️ Erreur fermeture screen peer ${id}:`, err);
        }
      }
    });
    
    screenPeersRef.current = {};
    
    if (socketRef.current) {
      socketRef.current.emit('leave-room', { roomId });
    }
    
    setIsInRoom(false);
    setParticipants([]);
    setChatMessages([]);
    setRemoteStreams({});
    setScreenStreams({});
    setIsScreenSharing(false);
    setHasJoinedRoom(false);
    setShowChat(false);
    setShowParticipants(false);
    
    console.log('✅ Salle quittée avec succès');
  };

  // ============ TOGGLE VIDEO - AUCUNE RENÉGOCIATION ============
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        const newState = !videoTrack.enabled;
        videoTrack.enabled = newState;
        setIsVideoOn(newState);
        console.log(`🎥 Vidéo ${newState ? 'activée' : 'désactivée'} - AUCUNE RENÉGOCIATION`);
        
        // Notifier les autres participants via Socket.io SEULEMENT
        socketRef.current.emit('toggle-video', { roomId, isVideoOn: newState });
      }
    }
  };

  // ============ TOGGLE AUDIO - AUCUNE RENÉGOCIATION ============
  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        const newState = !audioTrack.enabled;
        audioTrack.enabled = newState;
        setIsAudioOn(newState);
        console.log(`🎤 Audio ${newState ? 'activé' : 'désactivé'} - AUCUNE RENÉGOCIATION`);
        
        // Notifier les autres participants via Socket.io SEULEMENT
        socketRef.current.emit('toggle-audio', { roomId, isAudioOn: newState });
      } else {
        console.warn('⚠️ Aucun track audio trouvé');
      }
    }
  };
  // ==============================================================

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      console.log('🖥️ Arrêt du partage d\'écran...');
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
      
      Object.values(screenPeersRef.current).forEach(peer => {
        if (peer) {
          try {
            peer.close();
          } catch (err) {
            console.warn(`⚠️ Erreur fermeture screen peer:`, err);
          }
        }
      });
      screenPeersRef.current = {};
      
      setIsScreenSharing(false);
      socketRef.current.emit('screen-share-stop', { roomId });
      console.log('✅ Partage d\'écran arrêté');
    } else {
      try {
        console.log('🖥️ Démarrage du partage d\'écran...');
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { 
            cursor: "always",
            displaySurface: "monitor"
          },
          audio: false
        });
        
        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);
        console.log('✅ Partage d\'écran démarré');
        
        socketRef.current.emit('screen-share-start', { roomId });
        
        participants.forEach(participant => {
          if (!participant.isLocal && participant.id !== socketRef.current?.id) {
            createScreenPeerConnection(participant.id, true);
          }
        });
        
        screenStream.getVideoTracks()[0].onended = () => {
          console.log('🖥️ Partage d\'écran terminé par l\'utilisateur');
          toggleScreenShare();
        };
      } catch (error) {
        console.error('❌ Erreur partage écran:', error);
        if (error.name !== 'NotAllowedError') {
          alert('Impossible de partager l\'écran');
        }
      }
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        alert('Le fichier est trop volumineux (max 10MB)');
        return;
      }
      setSelectedFile(file);
      console.log('📄 Fichier sélectionné:', file.name);
    }
  };

  const uploadFile = async () => {
    if (!selectedFile) return null;

    console.log('📤 Upload du fichier...');
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch(`${SOCKET_SERVER_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Upload échoué');

      const data = await response.json();
      console.log('✅ Fichier uploadé avec succès:', data.fileName);
      setSelectedFile(null);
      return data;
    } catch (error) {
      console.error('❌ Erreur upload:', error);
      alert('Erreur lors de l\'upload du fichier');
      return null;
    }
  };

  const sendMessage = async () => {
    const trimmedMessage = messageInput.trim();
    if (!trimmedMessage) {
      console.log('⚠️ Message vide, envoi annulé');
      return;
    }
    if (!hasJoinedRoom) {
      console.log('⚠️ Pas encore dans la salle, envoi annulé');
      return;
    }
    if (!socketRef.current || !socketRef.current.connected) {
      console.log('⚠️ Socket non connecté, envoi annulé');
      return;
    }

    console.log('💬 Envoi du message:', trimmedMessage);
    try {
      socketRef.current.emit('chat-message', { 
        roomId, 
        message: trimmedMessage,
        fileUrl: null,
        fileName: null,
        fileType: null,
        fileSize: null
      });
      
      setMessageInput('');
      setSelectedFile(null);
      
      setTimeout(() => {
        messageInputRef.current?.focus();
      }, 100);
    } catch (error) {
      console.error('❌ Erreur lors de l\'envoi du message:', error);
      alert('Erreur lors de l\'envoi du message. Veuillez réessayer.');
    }
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
    
    const message = chatMessages.find(m => m.id === messageId);
    const currentUserId = socketRef.current?.id;
    
    if (message && message.reactions && message.reactions[reaction]) {
      const hasThisReaction = message.reactions[reaction].includes(currentUserId);
      if (hasThisReaction) {
        socketRef.current.emit('react-message', { roomId, messageId, reaction });
      } else {
        socketRef.current.emit('react-message', { roomId, messageId, reaction });
      }
    } else {
      socketRef.current.emit('react-message', { roomId, messageId, reaction });
    }
    
    setShowEmojiPicker(null);
    setShowMessageMenu(null);
  };

  const loadMedia = async (file) => {
    if (!isCreator) {
      alert('Seul le créateur de la salle peut partager des médias');
      return;
    }

    if (!file) return;

    const fileType = file.type;
    let mediaType = null;
    
    if (fileType.startsWith('video/')) mediaType = 'video';
    else if (fileType.startsWith('audio/')) mediaType = 'audio';
    else if (fileType === 'application/pdf') mediaType = 'pdf';
    else {
      alert('Type de fichier non supporté. Utilisez vidéo, audio ou PDF.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${SOCKET_SERVER_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Upload échoué');
      const data = await response.json();

      socketRef.current.emit('media-action', {
        roomId,
        action: 'load',
        type: mediaType,
        url: data.fileUrl
      });

      setMediaState({
        type: mediaType,
        url: data.fileUrl,
        isPlaying: false,
        currentTime: 0,
        lastUpdatedServerTime: Date.now(),
        pageNumber: mediaType === 'pdf' ? 1 : null
      });
      setShowMediaPlayer(true);
    } catch (error) {
      console.error('Erreur upload média:', error);
      alert('Erreur lors du chargement du média');
    }
  };

  const handleMediaPlay = () => {
    if (!isCreator || !mediaPlayerRef.current) return;
    
    if (isReceivingRemoteUpdate.current) return;
    
    const player = mediaPlayerRef.current;
    const currentTime = player.currentTime || 0;
    
    socketRef.current.emit('media-action', {
      roomId,
      action: 'play',
      type: mediaState?.type,
      currentTime
    });

    setMediaState(prev => ({
      ...prev,
      isPlaying: true,
      currentTime,
      lastUpdatedServerTime: Date.now()
    }));
  };

  const handleMediaPause = () => {
    if (!isCreator || !mediaPlayerRef.current) return;
    
    if (isReceivingRemoteUpdate.current) return;
    
    const player = mediaPlayerRef.current;
    const currentTime = player.currentTime || 0;
    
    socketRef.current.emit('media-action', {
      roomId,
      action: 'pause',
      type: mediaState?.type,
      currentTime
    });

    setMediaState(prev => ({
      ...prev,
      isPlaying: false,
      currentTime,
      lastUpdatedServerTime: Date.now()
    }));
  };

  const handleMediaSeek = (time) => {
    if (!isCreator || !mediaPlayerRef.current) return;
    
    if (isReceivingRemoteUpdate.current) return;
    
    socketRef.current.emit('media-action', {
      roomId,
      action: 'seek',
      type: mediaState?.type,
      currentTime: time
    });

    setMediaState(prev => ({
      ...prev,
      currentTime: time,
      isPlaying: false,
      lastUpdatedServerTime: Date.now()
    }));
  };

  const stopMedia = () => {
    if (!isCreator) return;
    
    socketRef.current.emit('media-action', {
      roomId,
      action: 'stop'
    });

    setMediaState(null);
    setShowMediaPlayer(false);
  };

  const controlUserMedia = (targetUserId, action, value) => {
    if (!isCreator) {
      alert('Seul le créateur peut contrôler les autres participants');
      return;
    }

    socketRef.current.emit('control-user-media', {
      roomId,
      targetUserId,
      action,
      value
    });
  };

  const pinMessage = (messageId) => {
    console.log('📌 Épinglage du message:', messageId);
    socketRef.current.emit('pin-message', { roomId, messageId });
    setShowMessageMenu(null);
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    console.log('📋 ID de salle copié:', roomId);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatFileSize = (bytes) => {
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
            <p className="app-subtitle">Visioconférence nouvelle génération</p>
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
            <div className="feature">✓ Traversée NAT (STUN/TURN)</div>
            <div className="feature">✓ 100+ participants</div>
            <div className="feature">✓ Qualité HD</div>
            <div className="feature">✓ Partage d'écran</div>
            <div className="feature">✓ Chat avancé</div>
          </div>
        </div>
      </div>
    );
  }

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
                  <button onClick={stopMedia} className="close-media-btn" title="Arrêter le média">
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
                    onPlay={handleMediaPlay}
                    onPause={handleMediaPause}
                    onSeeked={(e) => handleMediaSeek(e.target.currentTime)}
                    className="media-player-element"
                  />
                )}
                {mediaState.type === 'audio' && (
                  <audio
                    ref={mediaPlayerRef}
                    src={mediaState.url}
                    controls
                    onPlay={handleMediaPlay}
                    onPause={handleMediaPause}
                    onSeeked={(e) => handleMediaSeek(e.target.currentTime)}
                    className="media-player-audio"
                  />
                )}
                {mediaState.type === 'pdf' && (
                  <div className="media-player-pdf">
                    <iframe
                      ref={mediaPlayerRef}
                      src={`${mediaState.url}#page=${mediaState.pageNumber || 1}`}
                      className="pdf-viewer"
                      title="PDF Viewer"
                      key={`pdf-${mediaState.pageNumber || 1}`}
                    />
                    <div className="pdf-controls">
                      <button onClick={() => {
                        if (isReceivingRemoteUpdate.current) return;
                        const newPage = Math.max(1, (mediaState.pageNumber || 1) - 1);
                        if (isCreator && newPage !== (mediaState.pageNumber || 1)) {
                          socketRef.current.emit('media-action', {
                            roomId,
                            action: 'page-change',
                            type: 'pdf',
                            pageNumber: newPage
                          });
                          setMediaState(prev => ({ ...prev, pageNumber: newPage, lastUpdatedServerTime: Date.now() }));
                        }
                      }} disabled={!isCreator || (mediaState.pageNumber || 1) <= 1}>
                        ← Page précédente
                      </button>
                      <span>Page {mediaState.pageNumber || 1}</span>
                      <button onClick={() => {
                        if (isReceivingRemoteUpdate.current) return;
                        const newPage = (mediaState.pageNumber || 1) + 1;
                        if (isCreator) {
                          socketRef.current.emit('media-action', {
                            roomId,
                            action: 'page-change',
                            type: 'pdf',
                            pageNumber: newPage
                          });
                          setMediaState(prev => ({ ...prev, pageNumber: newPage, lastUpdatedServerTime: Date.now() }));
                        }
                      }} disabled={!isCreator}>
                        Page suivante →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {isCreator && !showMediaPlayer && (
            <div className="media-upload-section">
              <input
                type="file"
                id="media-upload"
                accept="video/*,audio/*,.pdf"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) loadMedia(file);
                  e.target.value = '';
                }}
                style={{ display: 'none' }}
              />
              <label htmlFor="media-upload" className="media-upload-btn">
                📁 Partager un média (vidéo, audio ou PDF)
              </label>
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
              const audioDisabled = stream && stream.getAudioTracks().length > 0 && !stream.getAudioTracks()[0].enabled;
              
              return (
                <div key={participant.id} className="video-tile">
                  <video
                    ref={el => {
                      if (!el) return;
                      remoteVideosRef.current[participant.id] = el;
                      if (stream) {
                        el.srcObject = stream;
                        el.muted = false;
                        if (stream.getVideoTracks().length > 0) {
                          stream.getVideoTracks().forEach(track => {
                            track.enabled = !videoDisabled;
                          });
                        }
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
                      {audioDisabled && <MicOff size={16} />}
                    </div>
                  </div>
                  {(!stream || videoDisabled) && (
                    <div className="video-off-placeholder">
                      <div className="avatar-placeholder">
                        {participant.name.charAt(0).toUpperCase()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {Object.entries(screenStreams).map(([userId, stream]) => {
              const participant = participants.find(p => p.id === userId);
              return (
                <div key={`screen-${userId}`} className="video-tile screen-share-tile">
                  <video
                    ref={el => {
                      screenVideosRef.current[userId] = el;
                      if (el && stream) {
                        el.srcObject = stream;
                      }
                    }}
                    autoPlay
                    playsInline
                    className="video-element"
                  />
                  <div className="video-overlay">
                    <Monitor size={16} />
                    <span className="participant-name">
                      Écran de {participant?.name || 'Participant'}
                    </span>
                  </div>
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
                                  {msg.fileType?.startsWith('image/') && (
                                    <img src={msg.fileUrl} alt={msg.fileName} className="message-image" />
                                  )}
                                  {msg.fileType?.startsWith('audio/') && (
                                    <audio src={msg.fileUrl} controls className="message-audio" />
                                  )}
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
                    <div key={participant.id} className={`participant-item ${connectionLossState[participant.id] ? 'connection-lost' : ''}`}>
                      <div className="participant-avatar">
                        {participant.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="participant-info">
                        <span className="participant-name">{participant.name}</span>
                        {participant.isLocal && <span className="you-badge">Vous</span>}
                        {participant.isCreator && <span className="creator-badge">👑 Créateur</span>}
                        {connectionLossState[participant.id] && <span className="connection-lost-badge">⚠️ Connexion perdue</span>}
                      </div>
                      {isCreator && !participant.isLocal && (
                        <div className="participant-controls">
                          <button
                            onClick={() => controlUserMedia(participant.id, 'toggle-video', !userVideoStatus[participant.id])}
                            className="control-participant-btn"
                            title={`${userVideoStatus[participant.id] === false ? 'Activer' : 'Désactiver'} la caméra`}
                          >
                            <Video size={16} />
                          </button>
                          <button
                            onClick={() => controlUserMedia(participant.id, 'toggle-audio', true)}
                            className="control-participant-btn"
                            title="Désactiver le micro"
                          >
                            <Mic size={16} />
                          </button>
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