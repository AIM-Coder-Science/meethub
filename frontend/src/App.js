import React, { useState, useRef, useEffect } from 'react';
import { Video, VideoOff, Mic, MicOff, Phone, PhoneOff, MessageSquare, Users, Monitor, Copy, Check, MonitorOff } from 'lucide-react';
import io from 'socket.io-client';

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
  const [iceServers, setIceServers] = useState([]);
  
  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef({});
  const remoteVideosRef = useRef({});
  const chatMessagesEndRef = useRef(null);

  // Récupérer les credentials TURN
  useEffect(() => {
    const fetchTurnCredentials = async () => {
      try {
        const response = await fetch('https://meethub-khyr.onrender.com/api/turn-credentials');
        const data = await response.json();
        if (data.iceServers) {
          setIceServers(data.iceServers);
          console.log('✅ Credentials TURN récupérés');
        }
      } catch (error) {
        console.error('❌ Erreur TURN credentials, utilisation STUN:', error);
        setIceServers([
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]);
      }
    };
    
    fetchTurnCredentials();
  }, []);

  // Auto-scroll chat
  const scrollToBottom = () => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  // Nettoyage
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      Object.values(peersRef.current).forEach(peer => {
        if (peer) peer.close();
      });
    };
  }, []);

  // Initialiser Socket.io - CORRIGÉ
  useEffect(() => {
    console.log('🔌 Connexion au serveur:', SOCKET_SERVER_URL);
    
    socketRef.current = io(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    socketRef.current.on('connect', () => {
      console.log('✅ Connecté au serveur, ID:', socketRef.current.id);
      setConnectionStatus('Connecté');
    });

    socketRef.current.on('disconnect', () => {
      console.log('❌ Déconnecté du serveur');
      setConnectionStatus('Déconnecté');
      setHasJoinedRoom(false);
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('❌ Erreur de connexion:', error);
      setConnectionStatus('Erreur de connexion');
    });

    // CORRECTION: Gestion simplifiée des utilisateurs existants
    socketRef.current.on('existing-users', (users) => {
      console.log('👥 Utilisateurs existants:', users);
      users.forEach(user => {
        console.log(`➕ Ajout participant: ${user.name} (${user.id})`);
        addParticipant(user.id, user.name);
        // L'INITIATEUR crée la connexion
        createPeerConnection(user.id, true);
      });
    });

    // CORRECTION: Gestion simplifiée des nouveaux utilisateurs
    socketRef.current.on('user-joined', (user) => {
      console.log('✅ Utilisateur rejoint:', user);
      addParticipant(user.id, user.name);
      // Le NOUVEAU crée la connexion (non-initateur)
      createPeerConnection(user.id, false);
    });

    socketRef.current.on('user-left', (user) => {
      console.log('👋 Utilisateur parti:', user);
      removeParticipant(user.id);
      if (peersRef.current[user.id]) {
        peersRef.current[user.id].close();
        delete peersRef.current[user.id];
      }
      setRemoteStreams(prev => {
        const updated = { ...prev };
        delete updated[user.id];
        return updated;
      });
    });

    // CORRECTION: Gestion des offres
    socketRef.current.on('offer', async ({ from, offer }) => {
      console.log('📨 Offre reçue de:', from);
      try {
        if (!peersRef.current[from]) {
          console.log(`🆕 Création nouvelle connexion pour ${from}`);
          await createPeerConnection(from, false);
        }
        const peer = peersRef.current[from];
        if (peer && peer.signalingState !== 'stable') {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          console.log('✅ Description distante définie');
          
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socketRef.current.emit('answer', { to: from, answer });
          console.log('📤 Réponse envoyée à:', from);
        }
      } catch (error) {
        console.error('❌ Erreur traitement offre:', error);
      }
    });

    socketRef.current.on('answer', async ({ from, answer }) => {
      console.log('📨 Réponse reçue de:', from);
      try {
        const peer = peersRef.current[from];
        if (peer && peer.signalingState === 'have-local-offer') {
          await peer.setRemoteDescription(new RTCSessionDescription(answer));
          console.log('✅ Réponse traitée pour:', from);
        }
      } catch (error) {
        console.error('❌ Erreur traitement réponse:', error);
      }
    });

    socketRef.current.on('ice-candidate', async ({ from, candidate }) => {
      console.log('🧊 Candidat ICE reçu de:', from);
      try {
        const peer = peersRef.current[from];
        if (peer && candidate) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('✅ Candidat ICE ajouté pour:', from);
        }
      } catch (error) {
        console.error('❌ Erreur ajout candidat ICE:', error);
      }
    });

    socketRef.current.on('chat-message', (message) => {
      console.log('💬 Message reçu:', message);
      setChatMessages(prev => [...prev, message]);
    });

    socketRef.current.on('chat-history', (messages) => {
      console.log('📜 Historique chat:', messages.length, 'messages');
      setChatMessages(messages);
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // CORRECTION: Création connexion peer améliorée
  const createPeerConnection = async (userId, isInitiator) => {
    console.log(`🔗 Création connexion avec ${userId} (initiateur: ${isInitiator})`);
    
    try {
      // Configuration ICE simplifiée
      const configuration = {
        iceServers: iceServers.length > 0 ? iceServers : [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      };
      
      const peer = new RTCPeerConnection(configuration);
      peersRef.current[userId] = peer;

      // Ajouter les tracks locaux
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          peer.addTrack(track, localStreamRef.current);
          console.log(`➕ Track ${track.kind} ajouté pour ${userId}`);
        });
      }

      // Gestion des tracks distants
      peer.ontrack = (event) => {
        console.log(`🎬 Track reçu de ${userId}:`, event.track.kind);
        const stream = event.streams[0];
        
        if (stream) {
          setRemoteStreams(prev => ({
            ...prev,
            [userId]: stream
          }));

          // Mettre à jour la vidéo
          setTimeout(() => {
            if (remoteVideosRef.current[userId]) {
              remoteVideosRef.current[userId].srcObject = stream;
              console.log(`✅ Stream assigné à ${userId}`);
            }
          }, 100);
        }
      };

      // Candidats ICE
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current.emit('ice-candidate', {
            to: userId,
            candidate: event.candidate
          });
        }
      };

      // États de connexion
      peer.onconnectionstatechange = () => {
        console.log(`🔄 État ${userId}:`, peer.connectionState);
      };

      peer.oniceconnectionstatechange = () => {
        console.log(`🧊 ICE ${userId}:`, peer.iceConnectionState);
      };

      // CORRECTION: Logique initiateur/non-initateur simplifiée
      if (isInitiator) {
        try {
          console.log(`🎯 Création offre pour ${userId}`);
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          socketRef.current.emit('offer', {
            to: userId,
            offer: peer.localDescription
          });
          console.log(`📤 Offre envoyée à ${userId}`);
        } catch (error) {
          console.error(`❌ Erreur création offre:`, error);
        }
      }

      return peer;
    } catch (error) {
      console.error(`❌ Erreur création peer:`, error);
      return null;
    }
  };

  const addParticipant = (id, name) => {
    setParticipants(prev => {
      if (prev.find(p => p.id === id)) return prev;
      console.log(`➕ Participant: ${name} (${id})`);
      return [...prev, { id, name, isLocal: false }];
    });
  };

  const removeParticipant = (id) => {
    console.log(`➖ Participant retiré: ${id}`);
    setParticipants(prev => prev.filter(p => p.id !== id));
    if (remoteVideosRef.current[id]) {
      delete remoteVideosRef.current[id];
    }
  };

  // Démarrer le flux local
  const startLocalStream = async () => {
    try {
      console.log('🎥 Demande accès média...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      console.log('✅ Flux local démarré');
      return true;
    } catch (error) {
      console.error('❌ Erreur accès média:', error);
      alert('Impossible d\'accéder à la caméra/micro.');
      return false;
    }
  };

  // Rejoindre une salle
  const joinRoom = async () => {
    if (!userName.trim() || !roomId.trim()) {
      alert('Veuillez entrer votre nom et un ID de salle');
      return;
    }

    console.log(`🚪 Rejoindre salle: ${roomId}`);
    const success = await startLocalStream();
    if (success) {
      setIsInRoom(true);
      setParticipants([{ id: 'local', name: userName, isLocal: true }]);
      socketRef.current.emit('join-room', { roomId, userName });
      setHasJoinedRoom(true);
    }
  };

  // Quitter la salle
  const leaveRoom = () => {
    console.log('🚪 Quitter la salle...');
    
    // Arrêter tous les streams
    [localStreamRef.current, screenStreamRef.current].forEach(stream => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    });
    
    // Fermer toutes les connexions peer
    Object.values(peersRef.current).forEach(peer => peer?.close());
    peersRef.current = {};
    
    socketRef.current.emit('leave-room', { roomId });
    setIsInRoom(false);
    setParticipants([]);
    setChatMessages([]);
    setRemoteStreams({});
    setIsScreenSharing(false);
    setHasJoinedRoom(false);
  };

  // Toggle vidéo
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
        console.log('📹 Vidéo:', videoTrack.enabled ? 'ON' : 'OFF');
      }
    }
  };

  // Toggle audio
  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioOn(audioTrack.enabled);
        console.log('🎤 Audio:', audioTrack.enabled ? 'ON' : 'OFF');
      }
    }
  };

  // Partage d'écran
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Arrêter le partage
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
      setIsScreenSharing(false);
      
      // Revenir au flux caméra
      if (localVideoRef.current && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always" },
          audio: true
        });
        
        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        screenStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare();
        };
      } catch (error) {
        console.error('❌ Erreur partage écran:', error);
      }
    }
  };

  // Envoyer message
  const sendMessage = () => {
    if (messageInput.trim() && hasJoinedRoom) {
      socketRef.current.emit('chat-message', { roomId, message: messageInput });
      setMessageInput('');
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // CORRECTION: Style amélioré pour le scroll du chat
  const chatContainerStyle = {
    flex: 1,
    overflowY: 'auto',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    minHeight: 0
  };

  // [RESTE DU CODE IDENTIQUE JUSQU'À LA SECTION CHAT...]

  // Dans la partie Chat, REMPLACER le contenu par :
  {showChat && (
    <div style={{ 
      flex: 1, 
      display: 'flex', 
      flexDirection: 'column',
      minHeight: 0
    }}>
      {/* Messages avec scroll */}
      <div style={chatContainerStyle}>
        {chatMessages.map((msg) => (
          <div key={msg.id} style={{
            background: '#374151',
            borderRadius: '0.5rem',
            padding: '0.75rem',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.875rem', fontWeight: '500', color: '#60a5fa' }}>{msg.sender}</span>
              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                {new Date(msg.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p style={{ fontSize: '0.875rem', color: '#e5e7eb', margin: 0, wordBreak: 'break-word' }}>
              {msg.text}
            </p>
          </div>
        ))}
        <div ref={chatMessagesEndRef} />
      </div>

      {/* Input message */}
      <div style={{ 
        padding: '1rem', 
        borderTop: '1px solid #374151',
        background: '#1f2937',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Écrivez un message..."
            style={{
              flex: 1,
              padding: '0.5rem 0.75rem',
              background: '#374151',
              color: 'white',
              border: 'none',
              borderRadius: '0.5rem',
              outline: 'none'
            }}
          />
          <button
            onClick={sendMessage}
            style={{
              padding: '0.5rem 1rem',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer'
            }}
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  )}

{showParticipants && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {participants.map((participant) => (
                    <div key={participant.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      background: '#374151',
                      borderRadius: '0.5rem'
                    }}>
                      <div style={{
                        width: '2.5rem',
                        height: '2.5rem',
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #3b82f6 0%, #9333ea 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: 'bold'
                      }}>
                        {participant.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ color: 'white', fontWeight: '500' }}>{participant.name}</p>
                        {participant.isLocal && <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Vous</p>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        {participant.isVideoOn ? 
                          <Video style={{ width: '1rem', height: '1rem', color: '#10b981' }} /> : 
                          <VideoOff style={{ width: '1rem', height: '1rem', color: '#ef4444' }} />
                        }
                        {participant.isAudioOn ? 
                          <Mic style={{ width: '1rem', height: '1rem', color: '#10b981' }} /> : 
                          <MicOff style={{ width: '1rem', height: '1rem', color: '#ef4444' }} />
                        }
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Contrôles */}
      <div style={{
        background: '#1f2937',
        padding: '1rem 1.5rem',
        borderTop: '1px solid #374151'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
          <button
            onClick={toggleVideo}
            style={{
              padding: '1rem',
              borderRadius: '50%',
              background: isVideoOn ? '#374151' : '#dc2626',
              color: 'white',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            {isVideoOn ? <Video style={{ width: '1.5rem', height: '1.5rem' }} /> : <VideoOff style={{ width: '1.5rem', height: '1.5rem' }} />}
          </button>
          
          <button
            onClick={toggleAudio}
            style={{
              padding: '1rem',
              borderRadius: '50%',
              background: isAudioOn ? '#374151' : '#dc2626',
              color: 'white',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            {isAudioOn ? <Mic style={{ width: '1.5rem', height: '1.5rem' }} /> : <MicOff style={{ width: '1.5rem', height: '1.5rem' }} />}
          </button>

          <button
            onClick={toggleScreenShare}
            style={{
              padding: '1rem',
              borderRadius: '50%',
              background: isScreenSharing ? '#2563eb' : '#374151',
              color: 'white',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            {isScreenSharing ? <MonitorOff style={{ width: '1.5rem', height: '1.5rem' }} /> : <Monitor style={{ width: '1.5rem', height: '1.5rem' }} />}
          </button>

          <button
            onClick={() => setShowChat(!showChat)}
            style={{
              padding: '1rem',
              borderRadius: '50%',
              background: showChat ? '#2563eb' : '#374151',
              color: 'white',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <MessageSquare style={{ width: '1.5rem', height: '1.5rem' }} />
          </button>

          <button
            onClick={leaveRoom}
            style={{
              padding: '1rem',
              borderRadius: '50%',
              background: '#dc2626',
              color: 'white',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <PhoneOff style={{ width: '1.5rem', height: '1.5rem' }} />
          </button>
        </div>
      </div>
    </div>
  );
}
