import React, { useState, useRef, useEffect } from 'react';
import { Video, VideoOff, Mic, MicOff, Phone, PhoneOff, MessageSquare, Users, Monitor, Copy, Check, MonitorOff } from 'lucide-react';
import io from 'socket.io-client';

// Configuration - Changez cette URL pour votre serveur déployé
const SOCKET_SERVER_URL = 'https://meethub-khyr.onrender.com';

// Configuration ICE servers (STUN/TURN gratuits)
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
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
  const [copied, setCopied] = useState(false);
  
  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef({});
  const videoElementsRef = useRef({});

  // Générer un ID de salle aléatoire
  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  // Initialiser Socket.io
  useEffect(() => {
    socketRef.current = io(SOCKET_SERVER_URL);

    socketRef.current.on('connect', () => {
      console.log('Connecté au serveur');
    });

    socketRef.current.on('existing-users', (users) => {
      console.log('Utilisateurs existants:', users);
      users.forEach(user => {
        addParticipant(user.id, user.name);
        createPeerConnection(user.id, true);
      });
    });

    socketRef.current.on('user-joined', (user) => {
      console.log('Utilisateur rejoint:', user);
      addParticipant(user.id, user.name);
      createPeerConnection(user.id, false);
    });

    socketRef.current.on('user-left', (user) => {
      console.log('Utilisateur parti:', user);
      removeParticipant(user.id);
      if (peersRef.current[user.id]) {
        peersRef.current[user.id].close();
        delete peersRef.current[user.id];
      }
    });

    socketRef.current.on('offer', async ({ from, offer }) => {
      console.log('Offre reçue de:', from);
      const peer = peersRef.current[from];
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socketRef.current.emit('answer', { to: from, answer });
      }
    });

    socketRef.current.on('answer', async ({ from, answer }) => {
      console.log('Réponse reçue de:', from);
      const peer = peersRef.current[from];
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socketRef.current.on('ice-candidate', async ({ from, candidate }) => {
      const peer = peersRef.current[from];
      if (peer && candidate) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socketRef.current.on('chat-message', (message) => {
      setChatMessages(prev => [...prev, message]);
    });

    socketRef.current.on('chat-history', (messages) => {
      setChatMessages(messages);
    });

    socketRef.current.on('user-video-toggle', ({ userId, isVideoOn }) => {
      setParticipants(prev => prev.map(p => 
        p.id === userId ? { ...p, isVideoOn } : p
      ));
    });

    socketRef.current.on('user-audio-toggle', ({ userId, isAudioOn }) => {
      setParticipants(prev => prev.map(p => 
        p.id === userId ? { ...p, isAudioOn } : p
      ));
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Créer une connexion peer
  const createPeerConnection = (userId, isInitiator) => {
    const peer = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current[userId] = peer;

    // Ajouter les tracks locaux
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        peer.addTrack(track, localStreamRef.current);
      });
    }

    // Recevoir les tracks distants
    peer.ontrack = (event) => {
      console.log('Track reçu de:', userId);
      const videoElement = videoElementsRef.current[userId];
      if (videoElement) {
        videoElement.srcObject = event.streams[0];
      }
    };

    // Gestion des candidats ICE
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', {
          to: userId,
          candidate: event.candidate
        });
      }
    };

    // Si initiateur, créer l'offre
    if (isInitiator) {
      peer.createOffer()
        .then(offer => peer.setLocalDescription(offer))
        .then(() => {
          socketRef.current.emit('offer', {
            to: userId,
            offer: peer.localDescription
          });
        });
    }

    return peer;
  };

  // Ajouter un participant
  const addParticipant = (id, name) => {
    setParticipants(prev => {
      if (prev.find(p => p.id === id)) return prev;
      return [...prev, { id, name, isLocal: false, isVideoOn: true, isAudioOn: true }];
    });
  };

  // Retirer un participant
  const removeParticipant = (id) => {
    setParticipants(prev => prev.filter(p => p.id !== id));
    if (videoElementsRef.current[id]) {
      delete videoElementsRef.current[id];
    }
  };

  // Démarrer le flux vidéo local
  const startLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
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
      return true;
    } catch (error) {
      console.error('Erreur accès média:', error);
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

    const success = await startLocalStream();
    if (success) {
      setIsInRoom(true);
      setParticipants([{ id: 'local', name: userName, isLocal: true, isVideoOn: true, isAudioOn: true }]);
      socketRef.current.emit('join-room', { roomId, userName });
    }
  };

  // Quitter la salle
  const leaveRoom = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    Object.values(peersRef.current).forEach(peer => peer.close());
    peersRef.current = {};
    
    socketRef.current.emit('leave-room', { roomId });
    setIsInRoom(false);
    setParticipants([]);
    setChatMessages([]);
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
      }
    }
  };

  // Partage d'écran
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Arrêter le partage d'écran
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
      setIsScreenSharing(false);
      socketRef.current.emit('screen-share-stop', { roomId });
      
      // Réactiver la caméra
      if (localStreamRef.current && isVideoOn) {
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) videoTrack.enabled = true;
      }
    } else {
      // Démarrer le partage d'écran
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always" },
          audio: false
        });
        
        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);
        socketRef.current.emit('screen-share-start', { roomId });
        
        // Remplacer la vidéo locale par l'écran
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        // Détecter la fin du partage
        screenStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare();
        };
      } catch (error) {
        console.error('Erreur partage d\'écran:', error);
      }
    }
  };

  // Envoyer un message
  const sendMessage = () => {
    if (messageInput.trim()) {
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
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full mb-4">
              <Video className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">MeetHub Pro</h1>
            <p className="text-gray-600">Visioconférence professionnelle</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Votre nom
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Entrez votre nom"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ID de la salle
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  placeholder="Entrez ou générez un ID"
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                <button
                  onClick={() => setRoomId(generateRoomId())}
                  className="px-4 py-3 bg-gray-200 hover:bg-gray-300 rounded-lg font-medium transition-colors"
                >
                  Générer
                </button>
              </div>
            </div>

            <button
              onClick={joinRoom}
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold rounded-lg shadow-lg transition-all transform hover:scale-105"
            >
              Rejoindre la salle
            </button>
          </div>

          <div className="mt-6 text-center text-sm text-gray-600">
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
    <div className="h-screen bg-gray-900 flex flex-col">
      {/* En-tête */}
      <div className="bg-gray-800 px-6 py-4 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-white">MeetHub Pro</h1>
          <div className="flex items-center gap-2 bg-gray-700 px-3 py-2 rounded-lg">
            <span className="text-gray-300 text-sm">Salle: {roomId}</span>
            <button onClick={copyRoomId} className="text-gray-400 hover:text-white">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <button
          onClick={() => setShowParticipants(!showParticipants)}
          className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-white transition-colors"
        >
          <Users className="w-5 h-5" />
          <span>{participants.length}</span>
        </button>
      </div>

      {/* Zone principale */}
      <div className="flex-1 flex overflow-hidden">
        {/* Vidéos */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-fr">
            {/* Vidéo locale */}
            <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-3 left-3 bg-black bg-opacity-60 px-3 py-1 rounded-full">
                <span className="text-white text-sm font-medium">{userName} (Vous)</span>
              </div>
              {!isVideoOn && !isScreenSharing && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-700">
                  <VideoOff className="w-12 h-12 text-gray-400" />
                </div>
              )}
            </div>

            {/* Vidéos des autres participants */}
            {participants.filter(p => !p.isLocal).map((participant) => (
              <div key={participant.id} className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
                <video
                  ref={el => videoElementsRef.current[participant.id] = el}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-3 left-3 bg-black bg-opacity-60 px-3 py-1 rounded-full">
                  <span className="text-white text-sm font-medium">{participant.name}</span>
                </div>
                {!participant.isVideoOn && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-blue-600 to-purple-600">
                    <div className="text-white text-4xl font-bold">
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
          <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
            <div className="flex border-b border-gray-700">
              <button
                onClick={() => { setShowChat(true); setShowParticipants(false); }}
                className={`flex-1 py-3 px-4 text-sm font-medium ${showChat ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Chat
              </button>
              <button
                onClick={() => { setShowParticipants(true); setShowChat(false); }}
                className={`flex-1 py-3 px-4 text-sm font-medium ${showParticipants ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Participants
              </button>
            </div>

            {showChat && (
              <div className="flex-1 flex flex-col">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {chatMessages.map((msg) => (
                    <div key={msg.id} className="bg-gray-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-blue-400">{msg.sender}</span>
                        <span className="text-xs text-gray-400">
                          {new Date(msg.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm text-gray-200">{msg.text}</p>
                    </div>
                  ))}
                </div>
                <div className="p-4 border-t border-gray-700">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                      placeholder="Écrivez un message..."
                      className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={sendMessage}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      Envoyer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showParticipants && (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-2">
                  {participants.map((participant) => (
                    <div key={participant.id} className="flex items-center gap-3 p-3 bg-gray-700 rounded-lg">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
                        {participant.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="text-white font-medium">{participant.name}</p>
                        {participant.isLocal && <p className="text-xs text-gray-400">Vous</p>}
                      </div>
                      <div className="flex gap-1">
                        {participant.isVideoOn ? 
                          <Video className="w-4 h-4 text-green-500" /> : 
                          <VideoOff className="w-4 h-4 text-red-500" />
                        }
                        {participant.isAudioOn ? 
                          <Mic className="w-4 h-4 text-green-500" /> : 
                          <MicOff className="w-4 h-4 text-red-500" />
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
      <div className="bg-gray-800 px-6 py-4 border-t border-gray-700">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={toggleVideo}
            className={`p-4 rounded-full transition-all ${isVideoOn ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}`}
          >
            {isVideoOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          </button>
          
          <button
            onClick={toggleAudio}
            className={`p-4 rounded-full transition-all ${isAudioOn ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}`}
          >
            {isAudioOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </button>

          <button
            onClick={toggleScreenShare}
            className={`p-4 rounded-full transition-all ${isScreenSharing ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}`}
          >
            {isScreenSharing ? <MonitorOff className="w-6 h-6" /> : <Monitor className="w-6 h-6" />}
          </button>

          <button
            onClick={() => setShowChat(!showChat)}
            className={`p-4 rounded-full transition-all ${showChat ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}`}
          >
            <MessageSquare className="w-6 h-6" />
          </button>

          <button
            onClick={leaveRoom}
            className="p-4 rounded-full bg-red-600 hover:bg-red-700 text-white transition-all"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
}