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

// Firebase Admin Initialization - Using Vercel env vars
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
let db = null;
let bucket = null;

if (firebaseConfig && firebaseConfig.project_id) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(firebaseConfig),
      storageBucket: firebaseConfig.project_id + '.appspot.com'
    });
    db = admin.firestore();
    bucket = admin.storage().bucket();
    console.log('✅ Firebase initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
  }
} else {
  console.log('⚠️ Firebase config not found, using in-memory data');
}

// Collections
const TEAMS_COLLECTION = 'teams';
const MATCHES_COLLECTION = 'matches';
const PLAYERS_COLLECTION = 'players';
const TOURNAMENTS_COLLECTION = 'tournaments';

// In-memory fallback data (for when Firebase is not available)
let memoryData = {
  teams: [],
  players: [],
  matches: [],
  tournaments: []
};

// Helper function to generate ID
function generateId() {
  return uuidv4();
}

// ==================== JWT Authentication Middleware ====================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// ==================== Multer setup for file uploads ====================
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
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (username === adminUsername && password === adminPassword) {
      const token = jwt.sign(
        { username, role: 'admin' },
        process.env.JWT_SECRET || 'default_secret_key',
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
    if (db) {
      const snapshot = await db.collection(TEAMS_COLLECTION).get();
      const teams = [];
      snapshot.forEach(doc => {
        teams.push({ id: doc.id, ...doc.data() });
      });
      return res.json(teams);
    } else {
      // Fallback to memory
      return res.json(memoryData.teams);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/teams', authenticateToken, upload.single('logo'), async (req, res) => {
  try {
    const { name, coach, stadium } = req.body;
    let logoUrl = '';
    
    if (req.file && bucket) {
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
      createdAt: new Date().toISOString()
    };
    
    if (db) {
      const docRef = await db.collection(TEAMS_COLLECTION).add(teamData);
      return res.status(201).json({ id: docRef.id, ...teamData });
    } else {
      // Fallback to memory
      const newTeam = { id: generateId(), ...teamData };
      memoryData.teams.push(newTeam);
      return res.status(201).json(newTeam);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/teams/:id', authenticateToken, upload.single('logo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, coach, stadium } = req.body;
    const updateData = { name, coach, stadium };
    
    if (req.file && bucket) {
      const fileName = `teams/${uuidv4()}_${req.file.originalname}`;
      const file = bucket.file(fileName);
      await file.save(req.file.buffer, {
        contentType: req.file.mimetype,
        public: true
      });
      updateData.logo = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    }
    
    if (db) {
      await db.collection(TEAMS_COLLECTION).doc(id).update(updateData);
      const doc = await db.collection(TEAMS_COLLECTION).doc(id).get();
      return res.json({ id: doc.id, ...doc.data() });
    } else {
      // Fallback to memory
      const index = memoryData.teams.findIndex(t => t.id === id);
      if (index === -1) return res.status(404).json({ error: 'Team not found' });
      memoryData.teams[index] = { ...memoryData.teams[index], ...updateData };
      return res.json(memoryData.teams[index]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/teams/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (db) {
      await db.collection(TEAMS_COLLECTION).doc(id).delete();
      return res.json({ message: 'Team deleted successfully' });
    } else {
      // Fallback to memory
      memoryData.teams = memoryData.teams.filter(t => t.id !== id);
      return res.json({ message: 'Team deleted successfully' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PLAYERS CRUD ====================
app.get('/api/players', authenticateToken, async (req, res) => {
  try {
    const { teamId } = req.query;
    
    if (db) {
      let query = db.collection(PLAYERS_COLLECTION);
      if (teamId) {
        query = query.where('teamId', '==', teamId);
      }
      const snapshot = await query.get();
      const players = [];
      snapshot.forEach(doc => {
        players.push({ id: doc.id, ...doc.data() });
      });
      return res.json(players);
    } else {
      // Fallback to memory
      let players = memoryData.players;
      if (teamId) {
        players = players.filter(p => p.teamId === teamId);
      }
      return res.json(players);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/players', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const { name, position, number, teamId } = req.body;
    let photoUrl = '';
    
    if (req.file && bucket) {
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
      number: parseInt(number) || 0,
      teamId,
      photo: photoUrl,
      goals: 0,
      assists: 0,
      createdAt: new Date().toISOString()
    };
    
    if (db) {
      const docRef = await db.collection(PLAYERS_COLLECTION).add(playerData);
      return res.status(201).json({ id: docRef.id, ...playerData });
    } else {
      // Fallback to memory
      const newPlayer = { id: generateId(), ...playerData };
      memoryData.players.push(newPlayer);
      return res.status(201).json(newPlayer);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/players/:id', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, position, number, teamId, goals, assists } = req.body;
    const updateData = { 
      name, 
      position, 
      number: parseInt(number) || 0, 
      teamId 
    };
    
    if (goals !== undefined) updateData.goals = parseInt(goals) || 0;
    if (assists !== undefined) updateData.assists = parseInt(assists) || 0;
    
    if (req.file && bucket) {
      const fileName = `players/${uuidv4()}_${req.file.originalname}`;
      const file = bucket.file(fileName);
      await file.save(req.file.buffer, {
        contentType: req.file.mimetype,
        public: true
      });
      updateData.photo = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    }
    
    if (db) {
      await db.collection(PLAYERS_COLLECTION).doc(id).update(updateData);
      const doc = await db.collection(PLAYERS_COLLECTION).doc(id).get();
      return res.json({ id: doc.id, ...doc.data() });
    } else {
      // Fallback to memory
      const index = memoryData.players.findIndex(p => p.id === id);
      if (index === -1) return res.status(404).json({ error: 'Player not found' });
      memoryData.players[index] = { ...memoryData.players[index], ...updateData };
      return res.json(memoryData.players[index]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/players/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (db) {
      await db.collection(PLAYERS_COLLECTION).doc(id).delete();
      return res.json({ message: 'Player deleted successfully' });
    } else {
      // Fallback to memory
      memoryData.players = memoryData.players.filter(p => p.id !== id);
      return res.json({ message: 'Player deleted successfully' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== MATCHES CRUD ====================
app.get('/api/matches', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    
    if (db) {
      let query = db.collection(MATCHES_COLLECTION).orderBy('date', 'desc');
      if (status && status !== 'all') {
        query = query.where('status', '==', status);
      }
      const snapshot = await query.get();
      const matches = [];
      snapshot.forEach(doc => {
        matches.push({ id: doc.id, ...doc.data() });
      });
      return res.json(matches);
    } else {
      // Fallback to memory
      let matches = memoryData.matches;
      if (status && status !== 'all') {
        matches = matches.filter(m => m.status === status);
      }
      return res.json(matches);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/matches', authenticateToken, async (req, res) => {
  try {
    const { homeTeam, awayTeam, date, venue, tournament, homeScore, awayScore, status } = req.body;
    
    const matchData = {
      homeTeam: homeTeam || 'فريق 1',
      awayTeam: awayTeam || 'فريق 2',
      date: date || new Date().toISOString().split('T')[0],
      venue: venue || '',
      tournament: tournament || '',
      status: status || 'upcoming',
      homeScore: parseInt(homeScore) || 0,
      awayScore: parseInt(awayScore) || 0,
      createdAt: new Date().toISOString()
    };
    
    if (db) {
      const docRef = await db.collection(MATCHES_COLLECTION).add(matchData);
      return res.status(201).json({ id: docRef.id, ...matchData });
    } else {
      // Fallback to memory
      const newMatch = { id: generateId(), ...matchData };
      memoryData.matches.push(newMatch);
      return res.status(201).json(newMatch);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/matches/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { homeScore, awayScore, status, homeTeam, awayTeam, date, venue } = req.body;
    
    const updateData = {};
    if (homeScore !== undefined) updateData.homeScore = parseInt(homeScore) || 0;
    if (awayScore !== undefined) updateData.awayScore = parseInt(awayScore) || 0;
    if (status) updateData.status = status;
    if (homeTeam) updateData.homeTeam = homeTeam;
    if (awayTeam) updateData.awayTeam = awayTeam;
    if (date) updateData.date = date;
    if (venue) updateData.venue = venue;
    
    if (db) {
      await db.collection(MATCHES_COLLECTION).doc(id).update(updateData);
      const doc = await db.collection(MATCHES_COLLECTION).doc(id).get();
      return res.json({ id: doc.id, ...doc.data() });
    } else {
      // Fallback to memory
      const index = memoryData.matches.findIndex(m => m.id === id);
      if (index === -1) return res.status(404).json({ error: 'Match not found' });
      memoryData.matches[index] = { ...memoryData.matches[index], ...updateData };
      return res.json(memoryData.matches[index]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/matches/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (db) {
      await db.collection(MATCHES_COLLECTION).doc(id).delete();
      return res.json({ message: 'Match deleted successfully' });
    } else {
      // Fallback to memory
      memoryData.matches = memoryData.matches.filter(m => m.id !== id);
      return res.json({ message: 'Match deleted successfully' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TOURNAMENTS CRUD ====================
app.get('/api/tournaments', authenticateToken, async (req, res) => {
  try {
    if (db) {
      const snapshot = await db.collection(TOURNAMENTS_COLLECTION).get();
      const tournaments = [];
      snapshot.forEach(doc => {
        tournaments.push({ id: doc.id, ...doc.data() });
      });
      return res.json(tournaments);
    } else {
      return res.json(memoryData.tournaments);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tournaments', authenticateToken, async (req, res) => {
  try {
    const { name, season, currentStage, status, description } = req.body;
    
    const tournamentData = {
      name: name || 'بطولة جديدة',
      season: season || '',
      currentStage: currentStage || 'مرحلة المجموعات',
      status: status || 'upcoming',
      description: description || '',
      createdAt: new Date().toISOString()
    };
    
    if (db) {
      const docRef = await db.collection(TOURNAMENTS_COLLECTION).add(tournamentData);
      return res.status(201).json({ id: docRef.id, ...tournamentData });
    } else {
      // Fallback to memory
      const newTournament = { id: generateId(), ...tournamentData };
      memoryData.tournaments.push(newTournament);
      return res.status(201).json(newTournament);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tournaments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, season, currentStage, status, description } = req.body;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (season) updateData.season = season;
    if (currentStage) updateData.currentStage = currentStage;
    if (status) updateData.status = status;
    if (description) updateData.description = description;
    
    if (db) {
      await db.collection(TOURNAMENTS_COLLECTION).doc(id).update(updateData);
      const doc = await db.collection(TOURNAMENTS_COLLECTION).doc(id).get();
      return res.json({ id: doc.id, ...doc.data() });
    } else {
      // Fallback to memory
      const index = memoryData.tournaments.findIndex(t => t.id === id);
      if (index === -1) return res.status(404).json({ error: 'Tournament not found' });
      memoryData.tournaments[index] = { ...memoryData.tournaments[index], ...updateData };
      return res.json(memoryData.tournaments[index]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tournaments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (db) {
      await db.collection(TOURNAMENTS_COLLECTION).doc(id).delete();
      return res.json({ message: 'Tournament deleted successfully' });
    } else {
      // Fallback to memory
      memoryData.tournaments = memoryData.tournaments.filter(t => t.id !== id);
      return res.json({ message: 'Tournament deleted successfully' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== STATISTICS ====================
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    let teams = [];
    let players = [];
    let matches = [];
    
    if (db) {
      const teamsSnapshot = await db.collection(TEAMS_COLLECTION).get();
      const playersSnapshot = await db.collection(PLAYERS_COLLECTION).get();
      const matchesSnapshot = await db.collection(MATCHES_COLLECTION).get();
      
      teamsSnapshot.forEach(doc => teams.push(doc.data()));
      playersSnapshot.forEach(doc => players.push(doc.data()));
      matchesSnapshot.forEach(doc => matches.push(doc.data()));
    } else {
      teams = memoryData.teams;
      players = memoryData.players;
      matches = memoryData.matches;
    }
    
    const totalTeams = teams.length;
    const totalPlayers = players.length;
    const totalMatches = matches.length;
    const totalTournaments = memoryData.tournaments.length || 0;
    
    let completedMatches = 0;
    let upcomingMatches = 0;
    let liveMatches = 0;
    let totalGoals = 0;
    
    matches.forEach(match => {
      if (match.status === 'completed' || match.status === 'finished') {
        completedMatches++;
        totalGoals += (match.homeScore || 0) + (match.awayScore || 0);
      } else if (match.status === 'live') {
        liveMatches++;
      } else if (match.status === 'upcoming') {
        upcomingMatches++;
      }
    });
    
    // Top scorers
    const topScorers = players
      .sort((a, b) => (b.goals || 0) - (a.goals || 0))
      .slice(0, 5);
    
    res.json({
      totalTeams,
      totalPlayers,
      totalMatches,
      totalTournaments,
      completedMatches,
      upcomingMatches,
      liveMatches,
      totalGoals,
      topScorers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SEED DATA ====================
app.post('/api/seed', authenticateToken, async (req, res) => {
  try {
    // Sample teams
    const teamsData = [
      { name: 'ريال مدريد', coach: 'كارلو أنشيلوتي', stadium: 'سانتياغو برنابيو', logo: '' },
      { name: 'برشلونة', coach: 'تشافي هيرنانديز', stadium: 'كامب نو', logo: '' },
      { name: 'بايرن ميونخ', coach: 'توماس توخيل', stadium: 'أليانز أرينا', logo: '' },
      { name: 'مانشستر سيتي', coach: 'بيب غوارديولا', stadium: 'الاتحاد', logo: '' }
    ];
    
    const teamIds = [];
    for (const team of teamsData) {
      if (db) {
        const docRef = await db.collection(TEAMS_COLLECTION).add({
          ...team,
          createdAt: new Date().toISOString()
        });
        teamIds.push(docRef.id);
      } else {
        const newTeam = { id: generateId(), ...team, createdAt: new Date().toISOString() };
        memoryData.teams.push(newTeam);
        teamIds.push(newTeam.id);
      }
    }
    
    // Sample players
    const playersData = [
      { name: 'ليونيل ميسي', position: 'مهاجم', number: 10, teamId: teamIds[1], goals: 25, assists: 10 },
      { name: 'كريستيانو رونالدو', position: 'مهاجم', number: 7, teamId: teamIds[0], goals: 22, assists: 8 },
      { name: 'كيليان مبابي', position: 'مهاجم', number: 7, teamId: teamIds[2], goals: 20, assists: 12 },
      { name: 'إيرلينغ هالاند', position: 'مهاجم', number: 9, teamId: teamIds[3], goals: 28, assists: 5 }
    ];
    
    for (const player of playersData) {
      if (db) {
        await db.collection(PLAYERS_COLLECTION).add({
          ...player,
          photo: '',
          createdAt: new Date().toISOString()
        });
      } else {
        memoryData.players.push({
          id: generateId(),
          ...player,
          photo: '',
          createdAt: new Date().toISOString()
        });
      }
    }
    
    // Sample matches
    const matchesData = [
      { homeTeam: 'ريال مدريد', awayTeam: 'برشلونة', date: '2026-07-15', venue: 'سانتياغو برنابيو', tournament: 'الدوري الإسباني', status: 'finished', homeScore: 2, awayScore: 1 },
      { homeTeam: 'بايرن ميونخ', awayTeam: 'مانشستر سيتي', date: '2026-07-16', venue: 'أليانز أرينا', tournament: 'دوري أبطال أوروبا', status: 'finished', homeScore: 3, awayScore: 2 },
      { homeTeam: 'ريال مدريد', awayTeam: 'مانشستر سيتي', date: '2026-07-20', venue: 'سانتياغو برنابيو', tournament: 'دوري أبطال أوروبا', status: 'upcoming', homeScore: 0, awayScore: 0 },
      { homeTeam: 'برشلونة', awayTeam: 'بايرن ميونخ', date: '2026-07-21', venue: 'كامب نو', tournament: 'دوري أبطال أوروبا', status: 'upcoming', homeScore: 0, awayScore: 0 }
    ];
    
    for (const match of matchesData) {
      if (db) {
        await db.collection(MATCHES_COLLECTION).add({
          ...match,
          createdAt: new Date().toISOString()
        });
      } else {
        memoryData.matches.push({
          id: generateId(),
          ...match,
          createdAt: new Date().toISOString()
        });
      }
    }
    
    // Sample tournaments
    const tournamentsData = [
      { name: 'دوري أبطال أوروبا', season: '2025-2026', currentStage: 'ربع النهائي', status: 'live' },
      { name: 'الدوري الإسباني', season: '2025-2026', currentStage: 'الجولة 30', status: 'live' },
      { name: 'كأس العالم للأندية', season: '2026', currentStage: 'مرحلة المجموعات', status: 'upcoming' }
    ];
    
    for (const tournament of tournamentsData) {
      if (db) {
        await db.collection(TOURNAMENTS_COLLECTION).add({
          ...tournament,
          createdAt: new Date().toISOString()
        });
      } else {
        memoryData.tournaments.push({
          id: generateId(),
          ...tournament,
          createdAt: new Date().toISOString()
        });
      }
    }
    
    res.json({ message: '✅ Data seeded successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SERVE HTML FILES ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`⚽ MatchZone server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`🔐 Login: http://localhost:${PORT}/login`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
});
