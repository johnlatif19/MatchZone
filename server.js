require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Firebase Admin Initialization
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig),
  storageBucket: firebaseConfig.project_id + '.appspot.com'
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Collections
const TEAMS_COLLECTION = 'teams';
const MATCHES_COLLECTION = 'matches';
const PLAYERS_COLLECTION = 'players';
const TOURNAMENTS_COLLECTION = 'tournaments';

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed'), false);
    }
  }
});

// ==================== AUTH ROUTES ====================
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    if (username === adminUsername && password === adminPassword) {
      const token = jwt.sign(
        { username, role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      res.json({
        success: true,
        token,
        user: { username, role: 'admin' }
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// ==================== TEAMS CRUD ====================
app.get('/api/teams', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.collection(TEAMS_COLLECTION).get();
    const teams = [];
    snapshot.forEach(doc => {
      teams.push({ id: doc.id, ...doc.data() });
    });
    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/teams', authenticateToken, upload.single('logo'), async (req, res) => {
  try {
    const { name, coach, stadium } = req.body;
    let logoUrl = '';
    
    if (req.file) {
      const fileName = `teams/${uuidv4()}_${req.file.originalname}`;
      const file = bucket.file(fileName);
      await file.save(req.file.buffer, {
        contentType: req.file.mimetype,
        public: true
      });
      logoUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    }
    
    const teamData = {
      name,
      coach,
      stadium,
      logo: logoUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const docRef = await db.collection(TEAMS_COLLECTION).add(teamData);
    res.status(201).json({ id: docRef.id, ...teamData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/teams/:id', authenticateToken, upload.single('logo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, coach, stadium } = req.body;
    const updateData = { name, coach, stadium };
    
    if (req.file) {
      const fileName = `teams/${uuidv4()}_${req.file.originalname}`;
      const file = bucket.file(fileName);
      await file.save(req.file.buffer, {
        contentType: req.file.mimetype,
        public: true
      });
      updateData.logo = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    }
    
    await db.collection(TEAMS_COLLECTION).doc(id).update(updateData);
    const doc = await db.collection(TEAMS_COLLECTION).doc(id).get();
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/teams/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection(TEAMS_COLLECTION).doc(id).delete();
    res.json({ message: 'Team deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PLAYERS CRUD ====================
app.get('/api/players', authenticateToken, async (req, res) => {
  try {
    const { teamId } = req.query;
    let query = db.collection(PLAYERS_COLLECTION);
    
    if (teamId) {
      query = query.where('teamId', '==', teamId);
    }
    
    const snapshot = await query.get();
    const players = [];
    snapshot.forEach(doc => {
      players.push({ id: doc.id, ...doc.data() });
    });
    res.json(players);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/players', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const { name, position, number, teamId } = req.body;
    let photoUrl = '';
    
    if (req.file) {
      const fileName = `players/${uuidv4()}_${req.file.originalname}`;
      const file = bucket.file(fileName);
      await file.save(req.file.buffer, {
        contentType: req.file.mimetype,
        public: true
      });
      photoUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    }
    
    const playerData = {
      name,
      position,
      number: parseInt(number),
      teamId,
      photo: photoUrl,
      goals: 0,
      assists: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const docRef = await db.collection(PLAYERS_COLLECTION).add(playerData);
    res.status(201).json({ id: docRef.id, ...playerData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/players/:id', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, position, number, teamId, goals, assists } = req.body;
    const updateData = { name, position, number: parseInt(number), teamId };
    
    if (goals !== undefined) updateData.goals = parseInt(goals);
    if (assists !== undefined) updateData.assists = parseInt(assists);
    
    if (req.file) {
      const fileName = `players/${uuidv4()}_${req.file.originalname}`;
      const file = bucket.file(fileName);
      await file.save(req.file.buffer, {
        contentType: req.file.mimetype,
        public: true
      });
      updateData.photo = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    }
    
    await db.collection(PLAYERS_COLLECTION).doc(id).update(updateData);
    const doc = await db.collection(PLAYERS_COLLECTION).doc(id).get();
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/players/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection(PLAYERS_COLLECTION).doc(id).delete();
    res.json({ message: 'Player deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== MATCHES CRUD ====================
app.get('/api/matches', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    let query = db.collection(MATCHES_COLLECTION).orderBy('date', 'desc');
    
    if (status && status !== 'all') {
      query = query.where('status', '==', status);
    }
    
    const snapshot = await query.get();
    const matches = [];
    snapshot.forEach(doc => {
      matches.push({ id: doc.id, ...doc.data() });
    });
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/matches', authenticateToken, async (req, res) => {
  try {
    const { homeTeamId, awayTeamId, date, venue, tournament } = req.body;
    
    const matchData = {
      homeTeamId,
      awayTeamId,
      date: new Date(date),
      venue,
      tournament,
      status: 'upcoming',
      homeScore: 0,
      awayScore: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const docRef = await db.collection(MATCHES_COLLECTION).add(matchData);
    res.status(201).json({ id: docRef.id, ...matchData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/matches/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { homeScore, awayScore, status } = req.body;
    
    const updateData = {};
    if (homeScore !== undefined) updateData.homeScore = parseInt(homeScore);
    if (awayScore !== undefined) updateData.awayScore = parseInt(awayScore);
    if (status) updateData.status = status;
    
    await db.collection(MATCHES_COLLECTION).doc(id).update(updateData);
    const doc = await db.collection(MATCHES_COLLECTION).doc(id).get();
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/matches/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection(MATCHES_COLLECTION).doc(id).delete();
    res.json({ message: 'Match deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== STATISTICS ====================
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const teamsSnapshot = await db.collection(TEAMS_COLLECTION).get();
    const playersSnapshot = await db.collection(PLAYERS_COLLECTION).get();
    const matchesSnapshot = await db.collection(MATCHES_COLLECTION).get();
    
    const totalTeams = teamsSnapshot.size;
    const totalPlayers = playersSnapshot.size;
    const totalMatches = matchesSnapshot.size;
    
    let completedMatches = 0;
    let upcomingMatches = 0;
    let totalGoals = 0;
    
    matchesSnapshot.forEach(doc => {
      const match = doc.data();
      if (match.status === 'completed') {
        completedMatches++;
        totalGoals += (match.homeScore || 0) + (match.awayScore || 0);
      } else if (match.status === 'upcoming') {
        upcomingMatches++;
      }
    });
    
    // Top scorers
    const players = [];
    playersSnapshot.forEach(doc => {
      players.push({ id: doc.id, ...doc.data() });
    });
    const topScorers = players
      .sort((a, b) => (b.goals || 0) - (a.goals || 0))
      .slice(0, 5);
    
    res.json({
      totalTeams,
      totalPlayers,
      totalMatches,
      completedMatches,
      upcomingMatches,
      totalGoals,
      topScorers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TOURNAMENTS ====================
app.get('/api/tournaments', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.collection(TOURNAMENTS_COLLECTION).get();
    const tournaments = [];
    snapshot.forEach(doc => {
      tournaments.push({ id: doc.id, ...doc.data() });
    });
    res.json(tournaments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tournaments', authenticateToken, async (req, res) => {
  try {
    const { name, season, teams } = req.body;
    const tournamentData = {
      name,
      season,
      teams: teams || [],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    const docRef = await db.collection(TOURNAMENTS_COLLECTION).add(tournamentData);
    res.status(201).json({ id: docRef.id, ...tournamentData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tournaments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection(TOURNAMENTS_COLLECTION).doc(id).delete();
    res.json({ message: 'Tournament deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== BRACKET ====================
app.get('/api/bracket/:tournamentId', authenticateToken, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const snapshot = await db.collection(MATCHES_COLLECTION)
      .where('tournament', '==', tournamentId)
      .get();
    
    const matches = [];
    snapshot.forEach(doc => {
      matches.push({ id: doc.id, ...doc.data() });
    });
    
    // Group matches by round
    const bracket = {};
    matches.forEach(match => {
      const round = match.round || 'Final';
      if (!bracket[round]) bracket[round] = [];
      bracket[round].push(match);
    });
    
    res.json(bracket);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bracket/:tournamentId', authenticateToken, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { rounds } = req.body;
    
    // Delete existing bracket matches for this tournament
    const existingMatches = await db.collection(MATCHES_COLLECTION)
      .where('tournament', '==', tournamentId)
      .get();
    
    const batch = db.batch();
    existingMatches.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    // Create new bracket matches
    const createdMatches = [];
    for (const round of rounds) {
      for (const match of round.matches) {
        const matchData = {
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          date: new Date(match.date),
          venue: match.venue,
          tournament: tournamentId,
          round: round.roundName,
          status: 'upcoming',
          homeScore: 0,
          awayScore: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const docRef = await db.collection(MATCHES_COLLECTION).add(matchData);
        createdMatches.push({ id: docRef.id, ...matchData });
      }
    }
    
    res.json(createdMatches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SEED DATA ====================
app.post('/api/seed', authenticateToken, async (req, res) => {
  try {
    // Seed teams
    const teamsData = [
      { name: 'Real Madrid', coach: 'Carlo Ancelotti', stadium: 'Santiago Bernabéu' },
      { name: 'Barcelona', coach: 'Xavi Hernandez', stadium: 'Camp Nou' },
      { name: 'Bayern Munich', coach: 'Thomas Tuchel', stadium: 'Allianz Arena' },
      { name: 'Manchester City', coach: 'Pep Guardiola', stadium: 'Etihad Stadium' }
    ];
    
    const teamIds = [];
    for (const team of teamsData) {
      const docRef = await db.collection(TEAMS_COLLECTION).add({
        ...team,
        logo: '',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      teamIds.push(docRef.id);
    }
    
    // Seed players
    const playersData = [
      { name: 'Lionel Messi', position: 'Forward', number: 10, teamId: teamIds[1] },
      { name: 'Cristiano Ronaldo', position: 'Forward', number: 7, teamId: teamIds[0] },
      { name: 'Kylian Mbappé', position: 'Forward', number: 7, teamId: teamIds[2] },
      { name: 'Erling Haaland', position: 'Forward', number: 9, teamId: teamIds[3] }
    ];
    
    for (const player of playersData) {
      await db.collection(PLAYERS_COLLECTION).add({
        ...player,
        photo: '',
        goals: 0,
        assists: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    // Seed matches
    const matchesData = [
      { homeTeamId: teamIds[0], awayTeamId: teamIds[1], date: new Date('2026-07-15'), venue: 'Santiago Bernabéu', tournament: 'La Liga', status: 'completed', homeScore: 2, awayScore: 1 },
      { homeTeamId: teamIds[2], awayTeamId: teamIds[3], date: new Date('2026-07-16'), venue: 'Allianz Arena', tournament: 'Champions League', status: 'completed', homeScore: 3, awayScore: 2 },
      { homeTeamId: teamIds[0], awayTeamId: teamIds[3], date: new Date('2026-07-20'), venue: 'Santiago Bernabéu', tournament: 'Champions League', status: 'upcoming', homeScore: 0, awayScore: 0 },
      { homeTeamId: teamIds[1], awayTeamId: teamIds[2], date: new Date('2026-07-21'), venue: 'Camp Nou', tournament: 'Champions League', status: 'upcoming', homeScore: 0, awayScore: 0 }
    ];
    
    for (const match of matchesData) {
      await db.collection(MATCHES_COLLECTION).add({
        ...match,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    res.json({ message: 'Data seeded successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.listen(PORT, () => {
  console.log(`MatchZone server running on port ${PORT}`);
});
