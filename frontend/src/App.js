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
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [showMessageMenu, setShowMessageMenu] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  
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

  const emojis = ['❤️', '👍', '👎', '😂', '😮', '😢', '🎉'];

  // Fermer les menus quand on clique ailleurs
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

  // Auto-scroll chat
  const scrollToBottom = () => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  // Récupérer les credentials TURN
  useEffect(() => {
    const fetchTurnCredentials = async () => {
      try {
        const response = await fetch(`${SOCKET_SERVER_URL}/api/turn-credentials`);
        if (!response.ok) throw new Error('Serveur indisponible');
        
        const data = await response.json();
        if (data.iceServers) {
          setIceServers(data.iceServers);
          console.log('✅ Credentials TURN récupérés');
        }
      } catch (error) {
        console.error('❌ Erreur TURN credentials:', error);
        setIceServers([
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun.voipbuster.com:3478' }
        ]);
      }
    };
    
    fetchTurnCredentials();
  }, []);

  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  // Nettoyage
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
      Object.values(peersRef.current).forEach(peer => peer?.close());
      Object.values(screenPeersRef.current).forEach(peer => peer?.close());
    };
  }, []);

  // Initialiser Socket.io
  useEffect(() => {
    socketRef.current = io(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    socketRef.current.on('connect', () => {
      console.log('✅ Connecté au serveur');
      setConnectionStatus('Connecté');
    });

    socketRef.current.on('disconnect', () => {
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
      addParticipant(user.id, user.name);
      createPeerConnection(user.id, false);
    });

    socketRef.current.on('user-left', (user) => {
      console.log('👋 Utilisateur parti:', user);
      removeParticipant(user.id);
      if (peersRef.current[user.id]) {
        peersRef.current[user.id].close();
        delete peersRef.current[user.id];
      }
      if (screenPeersRef.current[user.id]) {
        screenPeersRef.current[user.id].close();
        delete screenPeersRef.current[user.id];
      }
      setRemoteStreams(prev => {
        const updated = { ...prev };
        delete updated[user.id];
        return updated;
      });
      setScreenStreams(prev => {
        const updated = { ...prev };
        delete updated[user.id];
        return updated;
      });
    });

    socketRef.current.on('offer', async ({ from, offer }) => {
      console.log('📨 OFFRE reçue de:', from);
      let peer = peersRef.current[from];
      if (!peer) {
        peer = await createPeerConnection(from, false);
      }
      if (peer) {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socketRef.current.emit('answer', { to: from, answer });
        } catch (error) {
          console.error('❌ Erreur traitement offer:', error);
        }
      }
    });

    socketRef.current.on('answer', async ({ from, answer }) => {
      console.log('📨 RÉPONSE reçue de:', from);
      const peer = peersRef.current[from];
      if (peer) {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
          console.error('❌ Erreur traitement answer:', error);
        }
      }
    });

    socketRef.current.on('ice-candidate', async ({ from, candidate }) => {
      console.log('🧊 ICE CANDIDATE reçu de:', from);
      const peer = peersRef.current[from];
      if (peer && peer.remoteDescription) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('❌ Erreur ajout ICE candidate:', error);
        }
      }
    });

    // Gestion du partage d'écran
    socketRef.current.on('user-screen-share-start', ({ userId }) => {
      console.log(`📺 Partage d'écran démarré par ${userId}`);
      createScreenPeerConnection(userId, false);
    });

    socketRef.current.on('user-screen-share-stop', ({ userId }) => {
      console.log(`📺 Partage d'écran arrêté par ${userId}`);
      if (screenPeersRef.current[userId]) {
        screenPeersRef.current[userId].close();
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
      console.log('💬 Nouveau message:', message);
      setChatMessages(prev => [...prev, message]);
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

    socketRef.current.on('user-video-toggle', ({ userId, isVideoOn }) => {
      console.log('🎥 Vidéo toggle:', userId, isVideoOn);
      // Mettre à jour l'interface si nécessaire
    });

    socketRef.current.on('user-audio-toggle', ({ userId, isAudioOn }) => {
      console.log('🎤 Audio toggle:', userId, isAudioOn);
      // Mettre à jour l'interface si nécessaire
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Créer une connexion peer normale
  const createPeerConnection = async (userId, isInitiator) => {
    try {
      console.log(`🔗 Création peer ${userId} (initiateur: ${isInitiator})`);
      
      const configuration = {
        iceServers: iceServers.length > 0 ? iceServers : [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      };
      
      const peer = new RTCPeerConnection(configuration);
      peersRef.current[userId] = peer;

      // Ajouter les tracks locales
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          console.log(`🎯 Ajout track ${track.kind} à peer ${userId}`);
          peer.addTrack(track, localStreamRef.current);
        });
      }

      peer.ontrack = (event) => {
        console.log(`📹 Track reçu de ${userId}:`, event.track.kind);
        const stream = event.streams[0];
        if (stream) {
          console.log(`✅ Stream reçu de ${userId}, tracks:`, stream.getTracks().length);
          setRemoteStreams(prev => ({ ...prev, [userId]: stream }));
          
          // Attacher le stream à l'élément vidéo
          setTimeout(() => {
            const videoElement = remoteVideosRef.current[userId];
            if (videoElement && stream) {
              videoElement.srcObject = stream;
              console.log(`🎬 Vidéo attachée pour ${userId}`);
            }
          }, 100);
        }
      };

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`🧊 ICE candidate généré pour ${userId}`);
          socketRef.current.emit('ice-candidate', {
            to: userId,
            candidate: event.candidate
          });
        }
      };

      peer.oniceconnectionstatechange = () => {
        console.log(`🔌 État ICE ${userId}:`, peer.iceConnectionState);
      };

      peer.onconnectionstatechange = () => {
        console.log(`🔌 État connexion ${userId}:`, peer.connectionState);
      };

      if (isInitiator) {
        try {
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
        }
      }

      return peer;
    } catch (error) {
      console.error('❌ Erreur création peer:', error);
      return null;
    }
  };

  // Créer une connexion peer pour le partage d'écran
  const createScreenPeerConnection = async (userId, isInitiator) => {
    try {
      const configuration = {
        iceServers: iceServers.length > 0 ? iceServers : [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
      };
      
      const peer = new RTCPeerConnection(configuration);
      screenPeersRef.current[userId] = peer;

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

  const addParticipant = (id, name) => {
    setParticipants(prev => {
      if (prev.find(p => p.id === id)) return prev;
      console.log(`👤 Participant ajouté: ${name} (${id})`);
      return [...prev, { id, name, isLocal: false }];
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
      
      // Attendre un peu que le stream soit prêt
      setTimeout(() => {
        socketRef.current.emit('join-room', { roomId, userName });
        setHasJoinedRoom(true);
        console.log(`✅ Connecté à la salle ${roomId} en tant que ${userName}`);
      }, 500);
    }
  };

  const leaveRoom = () => {
    console.log('🚪 Quitter la salle...');
    
    // Arrêter tous les streams
    [localStreamRef.current, screenStreamRef.current].forEach(stream => {
      if (stream) {
        stream.getTracks().forEach(track => {
          track.stop();
          console.log(`🛑 Track ${track.kind} arrêté`);
        });
      }
    });
    
    // Fermer toutes les connexions peer
    Object.entries(peersRef.current).forEach(([id, peer]) => {
      if (peer) {
        peer.close();
        console.log(`🔒 Peer ${id} fermé`);
      }
    });
    
    Object.entries(screenPeersRef.current).forEach(([id, peer]) => {
      if (peer) {
        peer.close();
        console.log(`🔒 Screen peer ${id} fermé`);
      }
    });
    
    peersRef.current = {};
    screenPeersRef.current = {};
    
    // Notifier le serveur
    if (socketRef.current) {
      socketRef.current.emit('leave-room', { roomId });
    }
    
    // Réinitialiser l'état
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

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
        console.log(`🎥 Vidéo ${videoTrack.enabled ? 'activée' : 'désactivée'}`);
        socketRef.current.emit('toggle-video', { roomId, isVideoOn: videoTrack.enabled });
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
        socketRef.current.emit('toggle-audio', { roomId, isAudioOn: audioTrack.enabled });
      }
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Arrêter le partage
      console.log('🖥️ Arrêt du partage d\'écran...');
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
      
      Object.values(screenPeersRef.current).forEach(peer => {
        if (peer) {
          peer.close();
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
    if (!messageInput.trim() && !selectedFile) return;
    if (!hasJoinedRoom) return;

    let fileData = null;
    if (selectedFile) {
      fileData = await uploadFile();
      if (!fileData) return;
    }

    console.log('💬 Envoi du message...');
    socketRef.current.emit('chat-message', { 
      roomId, 
      message: messageInput,
      fileUrl: fileData?.fileUrl,
      fileName: fileData?.fileName,
      fileType: fileData?.fileType,
      fileSize: fileData?.fileSize
    });
    
    setMessageInput('');
    setSelectedFile(null);
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
      <header className="room-header">
        <div className="header-left">
          <button className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            <Menu />
          </button>
          <h1 className="room-title">MeetHub Pro</h1>
          <div className="room-id-badge">
            <span>Salle: {roomId}</span>
            <button onClick={copyRoomId} className="copy-btn">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
        <button onClick={() => { setShowParticipants(!showParticipants); setActiveTab('participants'); }} className="participants-btn">
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

          <div className="videos-grid">
            {/* Local Video */}
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

            {/* Remote Videos */}
            {participants.filter(p => !p.isLocal).map((participant) => (
              <div key={participant.id} className="video-tile">
                <video
                  ref={el => {
                    remoteVideosRef.current[participant.id] = el;
                    if (el && remoteStreams[participant.id]) {
                      el.srcObject = remoteStreams[participant.id];
                    }
                  }}
                  autoPlay
                  playsInline
                  className="video-element"
                />
                <div className="video-overlay">
                  <span className="participant-name">{participant.name}</span>
                </div>
                {!remoteStreams[participant.id] && (
                  <div className="video-off-placeholder">
                    <div className="avatar-placeholder">
                      {participant.name.charAt(0).toUpperCase()}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Screen Shares */}
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
            <div className={`sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
              <div className="sidebar-tabs">
                <button 
                  className={`tab ${activeTab === 'chat' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('chat'); setShowChat(true); setShowParticipants(false); }}
                >
                  Chat
                </button>
                <button 
                  className={`tab ${activeTab === 'participants' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('participants'); setShowParticipants(true); setShowChat(false); }}
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
                    {selectedFile && (
                      <div className="file-preview">
                        <span>{getFileIcon(selectedFile.type)} {selectedFile.name}</span>
                        <button onClick={() => setSelectedFile(null)} className="remove-file-btn">
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    
                    <div className="chat-input">
                      <input
                        type="text"
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                        placeholder="Écrivez un message..."
                        className="message-input"
                      />
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                        accept="image/*,audio/*,video/*,.pdf"
                      />
                      <button onClick={() => fileInputRef.current?.click()} className="attach-btn" title="Joindre un fichier">
                        <Paperclip size={20} />
                      </button>
                      <button onClick={sendMessage} className="send-btn" disabled={!messageInput.trim() && !selectedFile}>
                        <Send size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'participants' && (
                <div className="participants-list">
                  {participants.map((participant) => (
                    <div key={participant.id} className="participant-item">
                      <div className="participant-avatar">
                        {participant.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="participant-info">
                        <span className="participant-name">{participant.name}</span>
                        {participant.isLocal && <span className="you-badge">Vous</span>}
                      </div>
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

          <button onClick={() => { setShowChat(!showChat); setActiveTab('chat'); }} className={`control-btn ${showChat ? 'active' : ''}`} title="Ouvrir le chat">
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