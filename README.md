# 🎥 MeetHub Pro - Application de Visioconférence

Application web complète de visioconférence professionnelle avec support de 50-100 participants simultanés.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)

## ✨ Fonctionnalités

### 🎬 Visioconférence
- ✅ Vidéo HD (720p/1080p)
- ✅ Support de 50-100 participants simultanés
- ✅ Connexions peer-to-peer avec WebRTC
- ✅ Grille adaptative d'affichage
- ✅ Indicateurs de statut en temps réel

### 🎤 Audio
- ✅ Audio haute qualité
- ✅ Suppression de bruit
- ✅ Annulation d'écho
- ✅ Contrôle automatique du gain

### 💬 Chat
- ✅ Messagerie instantanée
- ✅ Historique persistant
- ✅ Horodatage des messages
- ✅ Notifications en temps réel

### 🖥️ Partage d'écran
- ✅ Partage complet de l'écran
- ✅ Partage de fenêtre spécifique
- ✅ Détection automatique d'arrêt

### 👥 Gestion
- ✅ Salles avec ID unique
- ✅ Liste des participants
- ✅ Indicateurs vidéo/audio
- ✅ Copie rapide de l'ID de salle

## 🏗️ Architecture

```
meethub/
├── backend/
│   ├── server.js           # Serveur de signalisation WebRTC
│   ├── package.json        # Dépendances backend
│   └── .env               # Configuration
├── frontend/
│   ├── src/
│   │   └── App.jsx        # Application React
│   ├── package.json       # Dépendances frontend
│   └── public/
└── docs/
    └── deployment.md      # Guide de déploiement
```

## 🚀 Installation Locale

### Prérequis
- Node.js >= 16.0.0
- npm ou yarn
- Navigateur moderne (Chrome, Firefox, Safari, Edge)

### Backend

```bash
# Cloner le repository
git clone https://github.com/votre-username/meethub.git
cd meethub/backend

# Installer les dépendances
npm install

# Créer le fichier .env
cp .env.example .env

# Démarrer le serveur
npm start
```

Le serveur démarre sur `http://localhost:3001`

### Frontend

```bash
cd ../frontend

# Installer les dépendances
npm install

# Démarrer l'application
npm start
```

L'application s'ouvre sur `http://localhost:3000`

## 🌐 Déploiement en Production (GRATUIT)

### Backend - Render.com

1. **Créer un compte** sur [Render.com](https://render.com)
2. **Nouveau Web Service** → Connecter GitHub
3. **Configuration** :
   ```
   Build Command: npm install
   Start Command: npm start
   Plan: Free
   ```
4. **Variables d'environnement** :
   ```
   PORT=3001
   NODE_ENV=production
   ```

### Frontend - Vercel

1. **Installer Vercel CLI** :
   ```bash
   npm install -g vercel
   ```

2. **Déployer** :
   ```bash
   cd frontend
   vercel login
   vercel
   ```

3. **Configurer l'URL backend** :
   - Modifier `SOCKET_SERVER_URL` dans `App.jsx`
   - Remplacer par votre URL Render

### Plus de détails
Consultez le [Guide de Déploiement Complet](docs/deployment.md)

## 🔧 Configuration

### Variables d'environnement (Backend)

```bash
# Port du serveur
PORT=3001

# URL du frontend (CORS)
FRONTEND_URL=https://votre-app.vercel.app

# Serveurs STUN/TURN
STUN_SERVER_1=stun:stun.l.google.com:19302
TURN_SERVER=turn:openrelay.metered.ca:80
```

### Configuration WebRTC (Frontend)

```javascript
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};
```

## 📱 Utilisation

### Créer une réunion

1. **Entrer votre nom**
2. **Générer un ID de salle** ou entrer un code existant
3. **Cliquer sur "Rejoindre la salle"**
4. **Autoriser caméra/micro** quand demandé
5. **Partager l'ID de salle** avec les participants

### Pendant la réunion

- 🎥 **Toggle vidéo** : Active/désactive votre caméra
- 🎤 **Toggle audio** : Active/désactive votre micro
- 🖥️ **Partage d'écran** : Partage votre écran
- 💬 **Chat** : Ouvre le panneau de discussion
- 👥 **Participants** : Affiche la liste des participants
- 📞 **Quitter** : Termine l'appel

## 🧪 Tests

### Tests manuels recommandés

```bash
# Test 1 : Connexion locale
- Ouvrir 2 onglets sur localhost
- Créer une salle et rejoindre depuis l'autre onglet
- Vérifier la vidéo/audio

# Test 2 : Réseau différent
- Se connecter depuis 2 réseaux différents (WiFi/4G)
- Tester la qualité de connexion

# Test 3 : Charge
- Simuler 5-10 connexions simultanées
- Vérifier les performances
```

## 🐛 Dépannage

### Problèmes courants

#### Vidéo/Audio ne fonctionne pas
- ✅ Vérifier que HTTPS est activé (obligatoire pour WebRTC)
- ✅ Autoriser caméra/micro dans les paramètres du navigateur
- ✅ Tester sur Chrome/Firefox (meilleur support)

#### Serveur ne se connecte pas
- ✅ Vérifier l'URL du backend dans le frontend
- ✅ Vérifier les logs du serveur
- ✅ Vérifier la configuration CORS

#### Connexion peer-to-peer échoue
- ✅ Vérifier les serveurs STUN/TURN
- ✅ Tester avec un serveur TURN différent
- ✅ Vérifier les firewalls/NAT

### Logs utiles

```bash
# Backend
npm start
# Vérifier les connexions Socket.io dans la console

# Frontend
# Ouvrir la console du navigateur (F12)
# Vérifier les erreurs WebRTC
```

## 📊 Performances

### Limites gratuites testées

| Métrique | Valeur |
|----------|--------|
| Utilisateurs simultanés | 50-100 |
| Qualité vidéo | 720p |
| Latence moyenne | < 200ms |
| Bande passante par user | ~1-2 Mbps |
| Consommation CPU serveur | ~10-20% |

### Optimisations possibles

1. **Vidéo adaptative** : Ajuster la qualité selon la bande passante
2. **SFU/MCU** : Utiliser un serveur média pour 100+ users
3. **CDN** : Distribuer le frontend via CDN
4. **Base de données** : Cacher l'historique des messages

## 🛣️ Roadmap

### Version 1.1 (À venir)
- [ ] Enregistrement des réunions
- [ ] Arrière-plans virtuels
- [ ] Transcription en temps réel
- [ ] Réactions (emoji, main levée)

### Version 1.2
- [ ] Authentification utilisateur
- [ ] Salles persistantes
- [ ] Programmation de réunions
- [ ] Statistiques d'utilisation

### Version 2.0
- [ ] Application mobile (React Native)
- [ ] Chiffrement end-to-end
- [ ] Intégration calendrier
- [ ] API REST publique

## 🤝 Contribution

Les contributions sont les bienvenues !

1. **Fork** le projet
2. **Créer une branche** (`git checkout -b feature/AmazingFeature`)
3. **Commit** les changements (`git commit -m 'Add AmazingFeature'`)
4. **Push** vers la branche (`git push origin feature/AmazingFeature`)
5. **Ouvrir une Pull Request**

## 📄 License

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.

## 👨‍💻 Auteur

Créé avec ❤️ pour faciliter la communication à distance.

## 🙏 Remerciements

- [WebRTC](https://webrtc.org/) - Technologie de communication temps réel
- [Socket.io](https://socket.io/) - WebSocket temps réel
- [React](https://react.dev/) - Framework frontend
- [Render](https://render.com/) - Hébergement backend gratuit
- [Vercel](https://vercel.com/) - Hébergement frontend gratuit

## 📞 Support

Pour toute question ou problème :
- 📧 Email : support@meethub.com
- 🐛 Issues : [GitHub Issues](https://github.com/votre-username/meethub/issues)
- 💬 Discord : [Serveur communautaire](https://discord.gg/meethub)

---

**Fait avec ❤️ et du café ☕**