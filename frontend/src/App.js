import React, { useState, useRef, useEffect } from 'react';
import { Video, VideoOff, Mic, MicOff, Phone, PhoneOff, MessageSquare, Users, Monitor, Copy, Check, MonitorOff } from 'lucide-react';
import io from 'socket.io-client';

// IMPORTANT : Remplacez par votre URL Render
const SOCKET_SERVER_URL = 'https://meethub-khyr.onrender.com';

// Configuration ICE servers
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

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
  
  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef({});
  const remoteVideosRef = useRef({});

  // Générer un ID de salle aléatoire
  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  // Nettoyer à la déconnexion
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

  // Initialiser Socket.io
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
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('❌ Erreur de connexion:', error);
      setConnectionStatus('Erreur de connexion');
    });

    socketRef.current.on('existing-users', (users) => {
      console.log('👥 Utilisateurs existants:', users);
      users.forEach(user => {
        addParticipant(user.id, user.name);
        setTimeout(() => createPeerConnection(user.id, true), 500);
      });
    });

    socketRef.current.on('user-joined', (user) => {
      console.log('✅ Utilisateur rejoint:', user);
      addParticipant(user.id, user.name);
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

    socketRef.current.on('offer', async ({ from, offer }) => {
      console.log('📨 Offre reçue de:', from);
      try {
        if (!peersRef.current[from]) {
          await createPeerConnection(from, false);
        }
        const peer = peersRef.current[from];
        if (peer) {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
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
        if (peer && peer.signalingState !== 'stable') {
          await peer.setRemoteDescription(new RTCSessionDescription(answer));
          console.log('✅ Description distante définie pour:', from);
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

  // Créer une connexion peer
  const createPeerConnection = async (userId, isInitiator) => {
    console.log(`🔗 Création connexion peer avec ${userId} (initiateur: ${isInitiator})`);
    
    try {
      const peer = new RTCPeerConnection(ICE_SERVERS);
      peersRef.current[userId] = peer;

      // Ajouter les tracks locaux
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          peer.addTrack(track, localStreamRef.current);
          console.log(`➕ Track ajouté (${track.kind}) pour ${userId}`);
        });
      }

      // Recevoir les tracks distants
      peer.ontrack = (event) => {
        console.log(`🎬 Track reçu de ${userId}:`, event.track.kind);
        const stream = event.streams[0];
        
        setRemoteStreams(prev => ({
          ...prev,
          [userId]: stream
        }));

        // Assigner le stream à la vidéo
        if (remoteVideosRef.current[userId]) {
          remoteVideosRef.current[userId].srcObject = stream;
          console.log(`✅ Stream assigné à la vidéo de ${userId}`);
        }
      };

      // Gestion des candidats ICE
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`🧊 Envoi candidat ICE à ${userId}`);
          socketRef.current.emit('ice-candidate', {
            to: userId,
            candidate: event.candidate
          });
        }
      };

      // État de la connexion
      peer.onconnectionstatechange = () => {
        console.log(`🔄 État connexion avec ${userId}:`, peer.connectionState);
        if (peer.connectionState === 'failed') {
          console.log(`❌ Connexion échouée avec ${userId}, redémarrage...`);
          peer.restartIce();
        }
      };

      peer.oniceconnectionstatechange = () => {
        console.log(`🧊 État ICE avec ${userId}:`, peer.iceConnectionState);
      };

      // Si initiateur, créer l'offre
      if (isInitiator) {
        try {
          const offer = await peer.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          });
          await peer.setLocalDescription(offer);
          socketRef.current.emit('offer', {
            to: userId,
            offer: peer.localDescription
          });
          console.log(`📤 Offre envoyée à ${userId}`);
        } catch (error) {
          console.error(`❌ Erreur création offre pour ${userId}:`, error);
        }
      }

      return peer;
    } catch (error) {
      console.error(`❌ Erreur création peer pour ${userId}:`, error);
      return null;
    }
  };

  // Ajouter un participant
  const addParticipant = (id, name) => {
    setParticipants(prev => {
      if (prev.find(p => p.id === id)) return prev;
      console.log(`➕ Participant ajouté: ${name} (${id})`);
      return [...prev, { id, name, isLocal: false, isVideoOn: true, isAudioOn: true }];
    });
  };

  // Retirer un participant
  const removeParticipant = (id) => {
    console.log(`➖ Participant retiré: ${id}`);
    setParticipants(prev => prev.filter(p => p.id !== id));
    if (remoteVideosRef.current[id]) {
      delete remoteVideosRef.current[id];
    }
  };

  // Démarrer le flux vidéo local
  const startLocalStream = async () => {
    try {
      console.log('🎥 Demande d\'accès média...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
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
      
      console.log('✅ Flux local démarré:', {
        video: stream.getVideoTracks().length,
        audio: stream.getAudioTracks().length
      });
      
      return true;
    } catch (error) {
      console.error('❌ Erreur accès média:', error);
      alert('Impossible d\'accéder à la caméra/micro. Vérifiez les permissions.');
      return false;
    }
  };

  // Rejoindre une salle
  const joinRoom = async () => {
    if (!userName.trim()) {
      alert('Veuillez entrer votre nom');
      return;
    }
    if (!roomId.trim()) {
      alert('Veuillez entrer un ID de salle');
      return;
    }

    console.log(`🚪 Tentative de rejoindre la salle: ${roomId}`);
    const success = await startLocalStream();
    if (success) {
      setIsInRoom(true);
      setParticipants([{ id: 'local', name: userName, isLocal: true, isVideoOn: true, isAudioOn: true }]);
      socketRef.current.emit('join-room', { roomId, userName });
      console.log(`✅ Émission join-room pour ${roomId}`);
    }
  };

  // Quitter la salle
  const leaveRoom = () => {
    console.log('🚪 Quitter la salle...');
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    Object.values(peersRef.current).forEach(peer => {
      if (peer) peer.close();
    });
    peersRef.current = {};
    
    socketRef.current.emit('leave-room', { roomId });
    setIsInRoom(false);
    setParticipants([]);
    setChatMessages([]);
    setRemoteStreams({});
    setIsScreenSharing(false);
  };

  // Toggle vidéo
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
        socketRef.current.emit('toggle-video', { roomId, isVideoOn: videoTrack.enabled });
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
        socketRef.current.emit('toggle-audio', { roomId, isAudioOn: audioTrack.enabled });
        console.log('🎤 Audio:', audioTrack.enabled ? 'ON' : 'OFF');
      }
    }
  };

  // Partage d'écran
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
      setIsScreenSharing(false);
      socketRef.current.emit('screen-share-stop', { roomId });
      
      if (localStreamRef.current && isVideoOn) {
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) videoTrack.enabled = true;
      }
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always" },
          audio: false
        });
        
        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);
        socketRef.current.emit('screen-share-start', { roomId });
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        screenStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare();
        };
      } catch (error) {
        console.error('❌ Erreur partage d\'écran:', error);
      }
    }
  };

  // Envoyer un message
  const sendMessage = () => {
    if (messageInput.trim()) {
      console.log('💬 Envoi message:', messageInput);
      socketRef.current.emit('chat-message', { roomId, message: messageInput });
      setMessageInput('');
    }
  };

  // Copier l'ID de salle
  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Page de connexion
  if (!isInRoom) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #7c3aed 50%, #4f46e5 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}>
        <div style={{
          background: 'white',
          borderRadius: '1rem',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          padding: '2rem',
          maxWidth: '28rem',
          width: '100%'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '4rem',
              height: '4rem',
              background: 'linear-gradient(135deg, #3b82f6 0%, #9333ea 100%)',
              borderRadius: '50%',
              marginBottom: '1rem'
            }}>
              <Video style={{ width: '2rem', height: '2rem', color: 'white' }} />
            </div>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '0.5rem' }}>
              MeetHub Pro
            </h1>
            <p style={{ color: '#6b7280' }}>Visioconférence professionnelle</p>
            <p style={{ fontSize: '0.75rem', color: connectionStatus === 'Connecté' ? '#10b981' : '#ef4444', marginTop: '0.5rem' }}>
              Status: {connectionStatus}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
                Votre nom
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Entrez votre nom"
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.5rem',
                  fontSize: '1rem',
                  outline: 'none'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
                ID de la salle
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  placeholder="Entrez ou générez un ID"
                  style={{
                    flex: 1,
                    padding: '0.75rem 1rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.5rem',
                    fontSize: '1rem',
                    outline: 'none'
                  }}
                />
                <button
                  onClick={() => setRoomId(generateRoomId())}
                  style={{
                    padding: '0.75rem 1rem',
                    background: '#e5e7eb',
                    border: 'none',
                    borderRadius: '0.5rem',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                >
                  Générer
                </button>
              </div>
            </div>

            <button
              onClick={joinRoom}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'linear-gradient(135deg, #3b82f6 0%, #9333ea 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '0.5rem',
                fontWeight: '600',
                fontSize: '1rem',
                cursor: 'pointer',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
              }}
            >
              Rejoindre la salle
            </button>
          </div>

          <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: '#6b7280' }}>
            <p>✓ Jusqu'à 50-100 participants</p>
            <p>✓ Chat • Vidéo HD • Audio clair</p>
            <p>✓ Partage d'écran inclus</p>
          </div>
        </div>
      </div>
    );
  }

  // Interface de visioconférence
  return (
    <div style={{ height: '100vh', background: '#111827', display: 'flex', flexDirection: 'column' }}>
      {/* En-tête */}
      <div style={{
        background: '#1f2937',
        padding: '1rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #374151'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'white' }}>MeetHub Pro</h1>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: '#374151',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.5rem'
          }}>
            <span style={{ color: '#d1d5db', fontSize: '0.875rem' }}>Salle: {roomId}</span>
            <button onClick={copyRoomId} style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              padding: '0.25rem'
            }}>
              {copied ? <Check style={{ width: '1rem', height: '1rem' }} /> : <Copy style={{ width: '1rem', height: '1rem' }} />}
            </button>
          </div>
        </div>
        <button
          onClick={() => setShowParticipants(!showParticipants)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: '#374151',
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            color: 'white',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          <Users style={{ width: '1.25rem', height: '1.25rem' }} />
          <span>{participants.length}</span>
        </button>
      </div>

      {/* Zone principale */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Vidéos */}
        <div style={{ flex: 1, padding: '1rem', overflowY: 'auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '1rem'
          }}>
            {/* Vidéo locale */}
            <div style={{ position: 'relative', background: '#1f2937', borderRadius: '0.5rem', overflow: 'hidden', aspectRatio: '16/9' }}>
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div style={{
                position: 'absolute',
                bottom: '0.75rem',
                left: '0.75rem',
                background: 'rgba(0,0,0,0.6)',
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px'
              }}>
                <span style={{ color: 'white', fontSize: '0.875rem', fontWeight: '500' }}>{userName} (Vous)</span>
              </div>
              {!isVideoOn && !isScreenSharing && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#374151'
                }}>
                  <VideoOff style={{ width: '3rem', height: '3rem', color: '#9ca3af' }} />
                </div>
              )}
            </div>

            {/* Vidéos des autres participants */}
            {participants.filter(p => !p.isLocal).map((participant) => (
              <div key={participant.id} style={{
                position: 'relative',
                background: '#1f2937',
                borderRadius: '0.5rem',
                overflow: 'hidden',
                aspectRatio: '16/9'
              }}>
                <video
                  ref={el => {
                    remoteVideosRef.current[participant.id] = el;
                    if (el && remoteStreams[participant.id]) {
                      el.srcObject = remoteStreams[participant.id];
                    }
                  }}
                  autoPlay
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div style={{
                  position: 'absolute',
                  bottom: '0.75rem',
                  left: '0.75rem',
                  background: 'rgba(0,0,0,0.6)',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '9999px'
                }}>
                  <span style={{ color: 'white', fontSize: '0.875rem', fontWeight: '500' }}>{participant.name}</span>
                </div>
                {!remoteStreams[participant.id] && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)'
                  }}>
                    <div style={{ color: 'white', fontSize: '2.25rem', fontWeight: 'bold' }}>
                      {participant.name.charAt(0).toUpperCase()}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Panneau latéral */}
        {(showChat || showParticipants) && (
          <div style={{
            width: '20rem',
            background: '#1f2937',
            borderLeft: '1px solid #374151',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ display: 'flex', borderBottom: '1px solid #374151' }}>
              <button
                onClick={() => { setShowChat(true); setShowParticipants(false); }}
                style={{
                  flex: 1,
                  padding: '0.75rem 1rem',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  background: showChat ? '#374151' : 'transparent',
                  color: showChat ? 'white' : '#9ca3af',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Chat
              </button>
              <button
                onClick={() => { setShowParticipants(true); setShowChat(false); }}
                style={{
                  flex: 1,
                  padding: '0.75rem 1rem',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  background: showParticipants ? '#374151' : 'transparent',
                  color: showParticipants ? 'white' : '#9ca3af',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Participants
              </button>
            </div>

            {showChat && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {chatMessages.map((msg) => (
                    <div key={msg.id} style={{
                      background: '#374151',
                      borderRadius: '0.5rem',
                      padding: '0.75rem'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: '500', color: '#60a5fa' }}>{msg.sender}</span>
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                          {new Date(msg.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.875rem', color: '#e5e7eb' }}>{msg.text}</p>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '1rem', borderTop: '1px solid #374151' }}>
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
