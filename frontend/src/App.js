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
  const [iceConfig, setIceConfig] = useState(null); // Nouvel état pour la configuration ICE
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [showMessageMenu, setShowMessageMenu] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [userVideoStatus, setUserVideoStatus] = useState({}); // {userId: isVideoOn}
  const [notification, setNotification] = useState(null);
  const [isCreator, setIsCreator] = useState(false);
  const [mediaState, setMediaState] = useState(null); // { type, url, isPlaying, currentTime, lastUpdatedServerTime, pageNumber }
  const [showMediaPlayer, setShowMediaPlayer] = useState(false);
  const mediaPlayerRef = useRef(null);
  const mediaSyncThreshold = 2000; // 2 secondes
  const isReceivingRemoteUpdate = useRef(false);
  const [iceConnectionAttempts, setIceConnectionAttempts] = useState({}); // Suivi des tentatives par peer
  
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

  // Récupérer les credentials TURN dynamiques du backend
  useEffect(() => {
    const fetchTurnCredentials = async () => {
      try {
        console.log('🔄 Récupération des credentials TURN...');
        
        const response = await fetch(`${SOCKET_SERVER_URL}/api/turn-credentials`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error(`Serveur indisponible: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📡 Données TURN reçues:', data);
        
        if (data.iceServers && Array.isArray(data.iceServers)) {
          // Construction de la configuration ICE complète
          // Les serveurs TURN (avec credentials) doivent être en priorité
          const turnServers = data.iceServers.filter(s => s.username && s.credential);
          const stunServers = data.iceServers.filter(s => !s.username || !s.credential);
          
          const config = {
            iceServers: [
              // TURN servers en priorité (pour traverser NAT/firewall)
              ...turnServers.map(server => ({
                urls: server.urls,
                username: server.username,
                credential: server.credential,
                credentialType: 'password'
              })),
              // STUN servers en backup
              ...stunServers.map(server => ({
                urls: server.urls
              }))
            ],
            iceTransportPolicy: 'all', // Essayer relay puis public puis private
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
          };
          
          setIceConfig(config);
          
          const twilioCount = turnServers.filter(s => s.urls && s.urls.includes('twilio')).length;
          console.log('✅ Configuration ICE complète chargée:', {
            totalServers: config.iceServers.length,
            turnServers: turnServers.length,
            stunServers: stunServers.length,
            twilioServers: twilioCount,
            hasTwilio: twilioCount > 0
          });
          
          // Pour compatibilité avec le code existant
          setIceServers(data.iceServers);
        } else {
          console.warn('⚠️ Format de données TURN invalide, utilisation des STUN par défaut');
          setIceConfig(getDefaultIceConfig());
        }
      } catch (error) {
        console.error('❌ Erreur récupération TURN credentials:', error);
        // Configuration de fallback
        setIceConfig(getDefaultIceConfig());
      }
    };
    
    fetchTurnCredentials();
    
    // Fonction helper pour la configuration par défaut
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
      addParticipant(user.id, user.name, user.isCreator);
      createPeerConnection(user.id, false);
    });

    socketRef.current.on('join-room-confirmation', ({ roomId, userName, success, isCreator: creatorStatus, timestamp }) => {
      if (success) {
        setIsCreator(creatorStatus || false);
        console.log(`✅ Rejoint la salle ${roomId}, créateur: ${creatorStatus || false}`);
        
        // Demander l'état initial du média
        if (socketRef.current) {
          socketRef.current.emit('get-media-state', { roomId });
        }
      }
    });

    // Gestion des médias synchronisés
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
          const adjustedTime = currentTime + (timeDiff / 1000); // Convertir en secondes
          
          // Seulement forcer le seek si la différence est > 2 secondes (seuil de synchronisation)
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
        
        // Mettre à jour le PDF viewer
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

    // Permissions du créateur : contrôler les autres utilisateurs
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
      // Nettoyer le suivi des tentatives
      setIceConnectionAttempts(prev => {
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

    socketRef.current.on('user-video-toggle', ({ userId, userName, isVideoOn }) => {
      console.log('🎥 Vidéo toggle:', userId, userName, isVideoOn);
      
      // Mettre à jour le statut vidéo de l'utilisateur
      setUserVideoStatus(prev => ({ ...prev, [userId]: isVideoOn }));
      
      // Afficher une notification
      if (userName) {
        setNotification({
          message: `${userName} a ${isVideoOn ? 'activé' : 'coupé'} sa caméra`,
          type: 'info',
          timestamp: Date.now()
        });
        
        // Masquer la notification après 3 secondes
        setTimeout(() => {
          setNotification(null);
        }, 3000);
      }
      
      // Si la vidéo est coupée, mettre à jour le stream pour masquer la vidéo
      setRemoteStreams(prev => {
        const stream = prev[userId];
        if (stream) {
          stream.getVideoTracks().forEach(track => {
            track.enabled = isVideoOn;
          });
          
          // Mettre à jour l'élément vidéo
          setTimeout(() => {
            const videoElement = remoteVideosRef.current[userId];
            if (videoElement) {
              videoElement.srcObject = stream;
              // Forcer la mise à jour
              videoElement.load();
            }
          }, 50);
        }
        return prev;
      });
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

  // Créer une connexion peer normale avec configuration ICE dynamique
  const createPeerConnection = async (userId, isInitiator) => {
    try {
      console.log(`🔗 Création peer ${userId} (initiateur: ${isInitiator})`);
      
      // Utiliser la configuration ICE récupérée ou la configuration par défaut
      // Attendre un peu si la configuration n'est pas encore chargée
      if (!iceConfig) {
        console.warn('⚠️ Configuration ICE non chargée, utilisation de la configuration par défaut');
      }
      
      const configuration = iceConfig || {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      };
      
      console.log('⚙️ Configuration ICE utilisée:', {
        hasTwilio: configuration.iceServers.some(s => s.urls && s.urls.includes('twilio')),
        totalServers: configuration.iceServers.length,
        servers: configuration.iceServers.map(s => ({
          urls: s.urls,
          hasCredentials: !!(s.username && s.credential)
        }))
      });
      
      const peer = new RTCPeerConnection(configuration);
      peersRef.current[userId] = peer;

      // Gestion robuste de l'état de la connexion
      peer.oniceconnectionstatechange = () => {
        const state = peer.iceConnectionState;
        console.log(`🔌 État ICE ${userId}:`, state);
        
        if (state === 'failed' || state === 'disconnected') {
          console.warn(`⚠️ Problème de connexion ICE pour ${userId}: ${state}`);
          
          // Tentative de récupération
          setIceConnectionAttempts(prev => {
            const attempts = (prev[userId] || 0) + 1;
            return { ...prev, [userId]: attempts };
          });
          
          const attempts = iceConnectionAttempts[userId] || 1;
          
          if (attempts <= 3) { // Maximum 3 tentatives
            console.log(`🔄 Tentative de récupération ICE ${attempts}/3 pour ${userId}`);
            
            setTimeout(() => {
              if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'disconnected') {
                console.log(`🔄 Redémarrage ICE pour ${userId}`);
                try {
                  // Réinitialiser la connexion ICE
                  peer.restartIce();
                  
                  // Recréer l'offre si nous sommes l'initiateur
                  if (isInitiator) {
                    peer.createOffer().then(offer => {
                      peer.setLocalDescription(offer);
                      socketRef.current.emit('offer', {
                        to: userId,
                        offer: peer.localDescription
                      });
                    }).catch(err => console.error('❌ Erreur recréation offer:', err));
                  }
                } catch (restartError) {
                  console.error('❌ Erreur restartIce:', restartError);
                }
              }
            }, 1000 * attempts); // Délai exponentiel
          } else {
            console.error(`❌ Échec de connexion ICE après ${attempts} tentatives pour ${userId}`);
            setNotification({
              message: `Impossible de se connecter à ${participants.find(p => p.id === userId)?.name || 'un participant'}. Vérifiez votre réseau.`,
              type: 'error',
              timestamp: Date.now()
            });
          }
        } else if (state === 'connected' || state === 'completed') {
          console.log(`✅ Connexion ICE établie avec ${userId}`);
          // Réinitialiser le compteur de tentatives
          setIceConnectionAttempts(prev => {
            const updated = { ...prev };
            delete updated[userId];
            return updated;
          });
        }
      };

      peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        console.log(`🔌 État connexion ${userId}:`, state);
        
        if (state === 'failed') {
          console.error(`❌ Échec de connexion WebRTC pour ${userId}`);
          // Essayer de recréer la connexion
          setTimeout(() => {
            if (peer.connectionState === 'failed') {
              console.log(`🔄 Recréation de la connexion pour ${userId}`);
              // Fermer l'ancienne connexion
              peer.close();
              delete peersRef.current[userId];
              // Recréer une nouvelle connexion
              createPeerConnection(userId, isInitiator);
            }
          }, 2000);
        }
      };

      peer.onsignalingstatechange = () => {
        console.log(`📡 État signaling ${userId}:`, peer.signalingState);
      };

      // Ajouter les tracks locales si le stream existe
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          console.log(`🎯 Ajout track ${track.kind} (enabled: ${track.enabled}) à peer ${userId}`);
          try {
            peer.addTrack(track, localStreamRef.current);
            console.log(`✅ Track ${track.kind} ajouté avec succès à peer ${userId}`);
          } catch (error) {
            console.error(`❌ Erreur ajout track ${track.kind} à peer ${userId}:`, error);
            // Essayer d'ajouter avec replaceTrack si le track existe déjà
            const sender = peer.getSenders().find(s => s.track && s.track.kind === track.kind);
            if (sender) {
              sender.replaceTrack(track).catch(err => console.error('Erreur replaceTrack:', err));
            }
          }
        });
      }

      // Écouter les changements de track (quand quelqu'un ajoute/retire des tracks)
      peer.ontrack = (event) => {
        console.log(`📹 Track reçu de ${userId}:`, event.track?.kind, event.track?.enabled);
        
        if (!event.track) {
          console.warn(`⚠️ Aucun track dans l'event pour ${userId}`);
          return;
        }
        
        const stream = event.streams && event.streams.length > 0 ? event.streams[0] : null;
        
        // Mettre à jour le stream existant ou créer un nouveau
        setRemoteStreams(prev => {
          const existing = prev[userId];
          
          if (existing) {
            // Si un stream existe déjà, vérifier si le track existe déjà
            const existingTrack = existing.getTracks().find(t => t.id === event.track.id);
            if (!existingTrack) {
              // Ajouter le nouveau track au stream existant
              existing.addTrack(event.track);
              console.log(`➕ Track ${event.track.kind} ajouté au stream existant de ${userId}`);
            } else {
              // Mettre à jour le track existant
              existingTrack.enabled = event.track.enabled;
              console.log(`🔄 Track ${event.track.kind} mis à jour pour ${userId}`);
            }
            
            // Attacher le stream à l'élément vidéo
            setTimeout(() => {
              const videoElement = remoteVideosRef.current[userId];
              if (videoElement) {
                videoElement.srcObject = existing;
                console.log(`🎬 Vidéo attachée pour ${userId} (stream existant)`);
              }
            }, 100);
            
            return { ...prev, [userId]: existing };
          } else {
            // Créer un nouveau stream
            const newStream = stream || new MediaStream();
            if (!stream && event.track) {
              newStream.addTrack(event.track);
            }
            
            console.log(`✅ Nouveau stream créé pour ${userId}, tracks:`, newStream.getTracks().length);
            
            // Attacher le stream à l'élément vidéo
            setTimeout(() => {
              const videoElement = remoteVideosRef.current[userId];
              if (videoElement) {
                videoElement.srcObject = newStream;
                console.log(`🎬 Vidéo attachée pour ${userId} (nouveau stream)`);
              }
            }, 100);
            
            return { ...prev, [userId]: newStream };
          }
        });
      };

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`🧊 ICE candidate généré pour ${userId} (type: ${event.candidate.type})`);
          socketRef.current.emit('ice-candidate', {
            to: userId,
            candidate: event.candidate
          });
        } else {
          console.log(`✅ Fin de génération des ICE candidates pour ${userId}`);
        }
      };

      peer.onicecandidateerror = (event) => {
        console.error(`❌ Erreur ICE candidate pour ${userId}:`, event.errorCode, event.errorText);
        // Ne pas bloquer pour les erreurs mineures
        if (event.errorCode === 701) {
          console.warn(`⚠️ Serveur STUN/TURN inaccessible pour ${userId}, continuation avec d'autres méthodes`);
        }
      };

      if (isInitiator) {
        try {
          const offerOptions = {
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
            iceRestart: false
          };
          
          const offer = await peer.createOffer(offerOptions);
          console.log(`📤 OFFRE créée pour ${userId}`);
          
          // Configurer les codecs préférés pour une meilleure compatibilité
          if (offer.sdp) {
            // Optimisation SDP pour une meilleure compatibilité
            offer.sdp = optimizeSdp(offer.sdp);
          }
          
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

  // Optimisation SDP pour une meilleure compatibilité
  const optimizeSdp = (sdp) => {
    let optimized = sdp;
    
    // Forcer l'utilisation de VP8 pour une meilleure compatibilité
    optimized = optimized.replace(/a=rtpmap:.* VP9\//g, '');
    optimized = optimized.replace(/a=rtpmap:.* H264\//g, '');
    
    // Ajouter des paramètres pour améliorer la stabilité
    optimized += '\r\na=ice-lite\r\n';
    optimized += 'a=ice-options:trickle\r\n';
    
    return optimized;
  };

  // Créer une connexion peer pour le partage d'écran
  const createScreenPeerConnection = async (userId, isInitiator) => {
    try {
      const configuration = iceConfig || {
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
      
      const peer = new RTCPeerConnection(configuration);
      screenPeersRef.current[userId] = peer;

      // Gestion des états de connexion pour le partage d'écran
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
      
      // Attendre que la configuration ICE soit chargée si nécessaire
      if (!iceConfig) {
        console.log('⏳ En attente de la configuration ICE...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
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
    
    // Réinitialiser le suivi des tentatives
    setIceConnectionAttempts({});
    
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
        const newState = !videoTrack.enabled;
        videoTrack.enabled = newState;
        setIsVideoOn(newState);
        console.log(`🎥 Vidéo ${newState ? 'activée' : 'désactivée'}`);
        
        // Mettre à jour tous les peers avec le nouveau track
        Object.entries(peersRef.current).forEach(([userId, peer]) => {
          if (peer) {
            const senders = peer.getSenders();
            const sender = senders.find(s => s.track && s.track.kind === 'video');
            if (sender && sender.track) {
              sender.track.enabled = newState;
            }
            
            // Si le track est activé, s'assurer qu'il est bien dans la connexion
            if (newState && videoTrack) {
              const hasTrack = senders.some(s => s.track && s.track.id === videoTrack.id);
              if (!hasTrack) {
                peer.addTrack(videoTrack, localStreamRef.current);
                // Recréer l'offer si nécessaire
                peer.createOffer().then(offer => {
                  peer.setLocalDescription(offer);
                  socketRef.current.emit('offer', {
                    to: userId,
                    offer: peer.localDescription
                  });
                }).catch(err => console.error('Erreur création offer:', err));
              }
            }
          }
        });
        
        socketRef.current.emit('toggle-video', { roomId, isVideoOn: newState });
      }
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        const newState = !audioTrack.enabled;
        audioTrack.enabled = newState;
        setIsAudioOn(newState);
        console.log(`🎤 Audio ${newState ? 'activé' : 'désactivé'}`);
        
        // Mettre à jour tous les peers avec le nouveau track audio
        Object.entries(peersRef.current).forEach(([userId, peer]) => {
          if (peer) {
            const senders = peer.getSenders();
            const sender = senders.find(s => s.track && s.track.kind === 'audio');
            if (sender && sender.track) {
              sender.track.enabled = newState;
            }
            
            // Si le track est activé, s'assurer qu'il est bien dans la connexion
            if (newState && audioTrack) {
              const hasTrack = senders.some(s => s.track && s.track.id === audioTrack.id);
              if (!hasTrack) {
                peer.addTrack(audioTrack, localStreamRef.current);
                // Recréer l'offer si nécessaire
                peer.createOffer().then(offer => {
                  peer.setLocalDescription(offer);
                  socketRef.current.emit('offer', {
                    to: userId,
                    offer: peer.localDescription
                  });
                }).catch(err => console.error('Erreur création offer audio:', err));
              }
            }
          }
        });
        
        socketRef.current.emit('toggle-audio', { roomId, isAudioOn: newState });
      } else {
        console.warn('⚠️ Aucun track audio trouvé');
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
    if (!messageInput.trim()) return; // Pas de fichiers, seulement du texte
    if (!hasJoinedRoom) return;

    console.log('💬 Envoi du message...');
    socketRef.current.emit('chat-message', { 
      roomId, 
      message: messageInput,
      fileUrl: null,
      fileName: null,
      fileType: null,
      fileSize: null
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
    
    // Vérifier si l'utilisateur a déjà cette réaction
    const message = chatMessages.find(m => m.id === messageId);
    const currentUserId = socketRef.current?.id;
    
    if (message && message.reactions && message.reactions[reaction]) {
      const hasThisReaction = message.reactions[reaction].includes(currentUserId);
      // Si l'utilisateur a déjà cette réaction, on la retire (pas d'émission)
      if (hasThisReaction) {
        // Le serveur gérera la suppression
        socketRef.current.emit('react-message', { roomId, messageId, reaction });
      } else {
        // Sinon, on l'ajoute (remplace les autres)
        socketRef.current.emit('react-message', { roomId, messageId, reaction });
      }
    } else {
      // Nouvelle réaction
      socketRef.current.emit('react-message', { roomId, messageId, reaction });
    }
    
    setShowEmojiPicker(null);
    setShowMessageMenu(null);
  };

  // Gestion des médias (seul le créateur peut contrôler)
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

    // Uploader le fichier
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${SOCKET_SERVER_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Upload échoué');
      const data = await response.json();

      // Envoyer l'action load au serveur
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
    
    if (isReceivingRemoteUpdate.current) return; // Éviter la boucle de feedback
    
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

  // Contrôle des autres utilisateurs (créateur uniquement)
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
            <div className={`ice-status ${iceConfig ? 'configured' : 'pending'}`}>
              <span className="ice-dot"></span>
              {iceConfig ? 'TURN/NAT configuré' : 'Configuration réseau...'}
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

            <button onClick={joinRoom} className="join-btn" disabled={!iceConfig}>
              <span>{iceConfig ? 'Rejoindre la salle' : 'Chargement de la configuration...'}</span>
              <div className="btn-glow"></div>
            </button>
          </div>

          <div className="features-list">
            <div className="feature">✓ Traversée NAT (TURN/Twilio)</div>
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
      {/* Notification */}
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
              // Si on ouvre le menu, afficher le chat par défaut
              setActiveTab('chat');
              setShowChat(true);
              setShowParticipants(false);
            } else {
              // Si on ferme, tout fermer
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
          <div className="ice-indicator" title="Configuration TURN/NAT active">
            <div className="ice-dot active"></div>
            <span>Réseau optimisé</span>
          </div>
        </div>
        <button onClick={() => { 
          setShowParticipants(!showParticipants); 
          setActiveTab('participants');
          setShowChat(false);
          // Sur mobile, ouvrir le menu
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

          {/* Lecteur de médias synchronisé */}
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
                    onTimeUpdate={(e) => {
                      if (!isReceivingRemoteUpdate.current && isCreator && mediaState) {
                        // Ne pas envoyer de mises à jour trop fréquentes
                        const now = Date.now();
                        const timeSinceLastUpdate = now - (mediaState.lastUpdatedServerTime || 0);
                        if (timeSinceLastUpdate > 500) { // Mettre à jour toutes les 500ms
                          // Ne rien faire ici, la synchronisation est gérée par les événements play/pause/seek
                        }
                      }
                    }}
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
                    onTimeUpdate={(e) => {
                      if (!isReceivingRemoteUpdate.current && isCreator && mediaState) {
                        // Ne pas envoyer de mises à jour trop fréquentes
                        const now = Date.now();
                        const timeSinceLastUpdate = now - (mediaState.lastUpdatedServerTime || 0);
                        if (timeSinceLastUpdate > 500) { // Mettre à jour toutes les 500ms
                          // Ne rien faire ici, la synchronisation est gérée par les événements play/pause/seek
                        }
                      }
                    }}
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

          {/* Bouton pour charger un média (créateur uniquement) */}
          {isCreator && !showMediaPlayer && (
            <div className="media-upload-section">
              <input
                type="file"
                id="media-upload"
                accept="video/*,audio/*,.pdf"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) loadMedia(file);
                  e.target.value = ''; // Réinitialiser pour permettre de sélectionner le même fichier
                }}
                style={{ display: 'none' }}
              />
              <label htmlFor="media-upload" className="media-upload-btn">
                📁 Partager un média (vidéo, audio ou PDF)
              </label>
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
                        el.muted = false; // Important : ne pas muter pour entendre l'audio
                        // Mettre à jour l'état enabled des tracks
                        if (stream.getVideoTracks().length > 0) {
                          stream.getVideoTracks().forEach(track => {
                            track.enabled = !videoDisabled;
                          });
                        }
                        // S'assurer que les tracks audio sont actifs
                        if (stream.getAudioTracks().length > 0) {
                          stream.getAudioTracks().forEach(track => {
                            // Les tracks audio sont gérés par l'utilisateur distant
                            console.log(`🎤 Audio track ${participant.id}: enabled=${track.enabled}`);
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
            <div className={`sidebar ${(isMobileMenuOpen || showChat || showParticipants) ? 'mobile-open' : ''}`}>
              <div className="sidebar-tabs">
                <button 
                  className={`tab ${activeTab === 'chat' ? 'active' : ''}`}
                  onClick={() => { 
                    setActiveTab('chat'); 
                    setShowChat(true); 
                    setShowParticipants(false);
                    // Sur mobile, s'assurer que le menu est ouvert
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
                    // Sur mobile, s'assurer que le menu est ouvert
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
                    {/* Prévisualisation de fichier désactivée */}
                    {false && selectedFile && (
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
                        inputMode="text"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck="false"
                        readOnly={false}
                      />
                      {/* Désactivation de l'envoi de fichiers - bouton caché */}
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                        accept="image/*,audio/*,video/*,.pdf"
                        disabled
                      />
                      {/* Bouton d'attachement désactivé et caché */}
                      {/* <button onClick={() => fileInputRef.current?.click()} className="attach-btn" title="Joindre un fichier" style={{ display: 'none' }}>
                        <Paperclip size={20} />
                      </button> */}
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
                    <div key={participant.id} className="participant-item">
                      <div className="participant-avatar">
                        {participant.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="participant-info">
                        <span className="participant-name">{participant.name}</span>
                        {participant.isLocal && <span className="you-badge">Vous</span>}
                        {participant.isCreator && <span className="creator-badge">👑 Créateur</span>}
                      </div>
                      {/* Contrôles du créateur */}
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
            // Sur mobile, ouvrir aussi le menu
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