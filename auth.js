// ═══════════════════════════════════════════
//  POKO — auth.js  (Phase 1 — localStorage)
//  Niveaux · Trust Score · Koni · RTP dynamique
// ═══════════════════════════════════════════

// ── CONFIG ─────────────────────────────────
const POKO_CONFIG = {
  // Mises par table
  tables: [
    { id:'leki',    name:'Leki',    mise:100,  trustMin:0,  icon:'🟢' },
    { id:'yaya',    name:'Yaya',    mise:500,  trustMin:30, icon:'🔵' },
    { id:'mokolo',  name:'Mokolo',  mise:1000, trustMin:60, icon:'🟡' },
    { id:'mokonzi', name:'Mokonzi', mise:2500, trustMin:85, icon:'🔴' },
  ],
  // Niveaux
  levels: {
    moke:   { name:'Moké',   icon:'🪵', label:'Débutant',   rtp:65, color:'#8B6914' },
    monene: { name:'Monéné', icon:'🔥', label:'Régulier',   rtp:null, color:'#E85D04' },
    koni:   { name:'Koni',   icon:'🌟', label:'Confirmé',   rtp:null, color:'#6A0DAD' },
    makala: { name:'Makala', icon:'👑', label:'Élite',      rtp:18, color:'#d4a017' },
  },
  levelThresholds: {
    moke_days: 15,       // 15 premiers jours
    monene:    5000,     // > 5 000 FCFA rechargés
    koni:      15000,    // > 15 000 FCFA rechargés
    makala:    30000,    // > 30 000 FCFA rechargés
  },
  // Koni
  koni: {
    perHundredFcfa: 5,   // 5 Koni par 100 FCFA rechargés
    rate: 0.5,           // 1 Koni = 0.5 FCFA
    expiryDays: 30,
    minConvert: 500,     // 500 Koni minimum pour convertir
  },
  // Bonus
  welcomeBonus: 200,
  dailyBonus: 50, // en Koni
};

// ── Surcharge admin depuis localStorage ────────
(()=>{
  try{
    const k=JSON.parse(localStorage.getItem('poko_koni_config')||'null');
    if(k){
      if(k.perHundredFcfa!=null) POKO_CONFIG.koni.perHundredFcfa = k.perHundredFcfa;
      if(k.rate         !=null) POKO_CONFIG.koni.rate            = k.rate;
      if(k.expiryDays   !=null) POKO_CONFIG.koni.expiryDays      = k.expiryDays;
      if(k.minConvert   !=null) POKO_CONFIG.koni.minConvert       = k.minConvert;
      if(k.dailyBonus   !=null) POKO_CONFIG.dailyBonus            = k.dailyBonus;
      if(k.welcomeBonus !=null) POKO_CONFIG.welcomeBonus          = k.welcomeBonus;
    }
  }catch(e){}
  try{
    const s=JSON.parse(localStorage.getItem('poko_admin_settings')||'null');
    if(s){
      if(s.rtpMoke     !=null) POKO_CONFIG.levels.moke.rtp            = s.rtpMoke;
      if(s.rtpMakala   !=null) POKO_CONFIG.levels.makala.rtp          = s.rtpMakala;
      if(s.mokeJours   !=null) POKO_CONFIG.levelThresholds.moke_days  = s.mokeJours;
      if(s.seuilMonene !=null) POKO_CONFIG.levelThresholds.monene     = s.seuilMonene;
      if(s.seuilKoni   !=null) POKO_CONFIG.levelThresholds.koni       = s.seuilKoni;
      if(s.seuilMakala !=null) POKO_CONFIG.levelThresholds.makala     = s.seuilMakala;
      if(s.welcomeBonus!=null) POKO_CONFIG.welcomeBonus               = s.welcomeBonus;
      if(s.dailyBonus  !=null) POKO_CONFIG.dailyBonus                 = s.dailyBonus;
    }
  }catch(e){}
})();

// ══════════════════════════════════════════════════
//  POKO_DB
// ══════════════════════════════════════════════════
const POKO_DB = {

  // ── Persistance ─────────────────────────
  getUsers()   { try { return JSON.parse(localStorage.getItem('poko_users') || '{}'); } catch(e) { return {}; } },
  saveUsers(u) { localStorage.setItem('poko_users', JSON.stringify(u)); },
  getSession() { try { return JSON.parse(sessionStorage.getItem('poko_session') || 'null'); } catch(e) { return null; } },
  setSession(u){ sessionStorage.setItem('poko_session', JSON.stringify({ ...u, lastActivity: Date.now() })); },
  clearSession(){ sessionStorage.removeItem('poko_session'); },

  _getSessionTimeout() {
    try {
      const s = JSON.parse(localStorage.getItem('poko_admin_settings') || '{}');
      return (s.sessionTimeout || 5) * 60 * 1000; // minutes → ms
    } catch(e) { return 5 * 60 * 1000; }
  },

  refreshSession() {
    const s = this.getSession();
    if (s) sessionStorage.setItem('poko_session', JSON.stringify({ ...s, lastActivity: Date.now() }));
  },

  currentUser() {
    const s = this.getSession();
    if (!s) return null;
    // Vérification timeout d'inactivité
    const timeout = this._getSessionTimeout();
    if (s.lastActivity && (Date.now() - s.lastActivity) > timeout) {
      this.clearSession();
      const page = window.location.pathname.split('/').pop();
      const authPages = ['index.html','login.html','register.html','admin-login.html',''];
      if (!authPages.includes(page)) window.location.href = 'index.html';
      return null;
    }
    const u = this.getUsers()[s.username] || null;
    if (!u) return null;
    return this._withFreshData(u);
  },
  async currentUserAsync() { return this.currentUser(); },

  // Recalcule level, trust score, expiry Koni à chaque lecture
  _withFreshData(user) {
    user.level      = this.calculateLevel(user);
    user.trustScore = this.calculateTrustScore(user);
    user = this._checkKoniExpiry(user);
    return user;
  },

  saveUser(user) {
    const users = this.getUsers();
    // Recalculer avant de sauvegarder
    user.level      = this.calculateLevel(user);
    user.trustScore = this.calculateTrustScore(user);
    this.updatePlayerRTP(user);
    users[user.username] = user;
    this.saveUsers(users);
  },

  // ── Calcul Niveau ────────────────────────
  calculateLevel(user) {
    const tr = user.totalRecharged || 0;
    const mokeStart  = user.mokeStart || user.createdAt || Date.now();
    const daysSince  = (Date.now() - mokeStart) / 86400000;
    if (daysSince < POKO_CONFIG.levelThresholds.moke_days && tr < POKO_CONFIG.levelThresholds.monene) return 'moke';
    if (tr >= POKO_CONFIG.levelThresholds.makala) return 'makala';
    if (tr >= POKO_CONFIG.levelThresholds.koni)   return 'koni';
    return 'monene';
  },

  getLevelInfo(level) {
    return POKO_CONFIG.levels[level] || POKO_CONFIG.levels.moke;
  },

  // Progression vers le prochain niveau
  getLevelProgress(user) {
    const tr  = user.totalRecharged || 0;
    const lvl = user.level || 'moke';
    const t   = POKO_CONFIG.levelThresholds;
    let current = 0, target = 0, nextLevel = null;
    if (lvl === 'moke') {
      const days = (Date.now() - (user.mokeStart || user.createdAt)) / 86400000;
      // Moké sort soit après 15j soit après 5000 FCFA rechargés
      const pctDays = Math.min(100, (days / t.moke_days) * 100);
      const pctFcfa = Math.min(100, (tr / t.monene) * 100);
      return { pct: Math.max(pctDays, pctFcfa), label: `${tr.toLocaleString('fr-FR')} / ${t.monene.toLocaleString('fr-FR')} FCFA rechargés`, nextLevel:'monene' };
    }
    if (lvl === 'monene') { current = tr - t.monene; target = t.koni - t.monene; nextLevel = 'koni'; }
    if (lvl === 'koni')   { current = tr - t.koni;   target = t.makala - t.koni; nextLevel = 'makala'; }
    if (lvl === 'makala') return { pct: 100, label: 'Niveau maximum', nextLevel: null };
    const pct = Math.min(100, Math.floor((current / target) * 100));
    return { pct, label: `${tr.toLocaleString('fr-FR')} / ${(lvl==='monene'?t.koni:t.makala).toLocaleString('fr-FR')} FCFA`, nextLevel };
  },

  // ── Trust Score ──────────────────────────
  calculateTrustScore(user) {
    if(user.vip) return 100; // VIP = toutes les tables débloquées
    const scores = { totalRecharged:0, frequency:0, seniority:0, behavior:0 };
    const tr = user.totalRecharged || 0;
    // 40% — Total rechargé
    if      (tr >= 30000) scores.totalRecharged = 40;
    else if (tr >= 10000) scores.totalRecharged = 25;
    else if (tr >= 5000)  scores.totalRecharged = 15;
    else scores.totalRecharged = Math.floor((tr / 5000) * 15);
    // 25% — Fréquence parties/semaine
    const daysActive = Math.max(1, (Date.now() - (user.createdAt || Date.now())) / 86400000);
    const gpw = (user.totalGames || 0) / (daysActive / 7);
    if      (gpw >= 20) scores.frequency = 25;
    else if (gpw >= 10) scores.frequency = 18;
    else if (gpw >= 5)  scores.frequency = 12;
    else scores.frequency = Math.floor(Math.min(gpw, 5) / 5 * 12);
    // 20% — Ancienneté
    if      (daysActive >= 90) scores.seniority = 20;
    else if (daysActive >= 30) scores.seniority = 14;
    else if (daysActive >= 15) scores.seniority = 8;
    else scores.seniority = Math.floor((daysActive / 15) * 8);
    // 15% — Comportement
    scores.behavior = user.banned ? 0 : 15;
    return Math.min(100, scores.totalRecharged + scores.frequency + scores.seniority + scores.behavior);
  },

  getAccessibleTables(user) {
    const score = user.trustScore || 0;
    return POKO_CONFIG.tables.map(t => ({ ...t, accessible: score >= t.trustMin }));
  },

  // ── RTP dynamique ────────────────────────
  getRTP(user) {
    const level = user.level || 'moke';
    if (level === 'moke')   return 65;
    if (level === 'makala') return 18;
    // Monéné / Koni : dynamique 15-35 selon winRate
    const winRate = (user.totalGames || 0) > 0
      ? (user.totalWins || 0) / user.totalGames
      : 0.4;
    if (winRate > 0.60) return 15;
    if (winRate < 0.20) return 35;
    return Math.round(35 - ((winRate - 0.2) / 0.4) * 20);
  },

  updatePlayerRTP(user) {
    // Si l'admin a un override manuel actif, ne pas écraser
    const overrides = JSON.parse(localStorage.getItem('poko_rtp_override') || '{}');
    if (overrides[user.username]) return;
    const rtp = this.getRTP(user);
    const settings = JSON.parse(localStorage.getItem('poko_rtp') || '{}');
    settings[user.username] = rtp;
    localStorage.setItem('poko_rtp', JSON.stringify(settings));
  },

  // ── Koni ─────────────────────────────────
  _checkKoniExpiry(user) {
    if (!user.koniBalance || user.koniBalance <= 0) return user;
    if (!user.lastKoniActivity) return user;
    const daysSince = (Date.now() - user.lastKoniActivity) / 86400000;
    if (daysSince >= POKO_CONFIG.koni.expiryDays) {
      user.koniBalance = 0;
      user.lastKoniActivity = null;
    }
    return user;
  },

  earnKoni(user, depositAmount) {
    const earned = Math.floor(depositAmount / 100) * POKO_CONFIG.koni.perHundredFcfa;
    if (earned <= 0) return user;
    user.koniBalance = (user.koniBalance || 0) + earned;
    user.lastKoniActivity = Date.now();
    return { user, earned };
  },

  async convertKoni(koniAmount) {
    const user = this.currentUser();
    if (!user) return { ok:false, msg:'Non connecté.' };
    if ((user.koniBalance || 0) < POKO_CONFIG.koni.minConvert)
      return { ok:false, msg:`Minimum ${POKO_CONFIG.koni.minConvert} Koni pour convertir.` };
    if (koniAmount < POKO_CONFIG.koni.minConvert)
      return { ok:false, msg:`Minimum ${POKO_CONFIG.koni.minConvert} Koni.` };
    if (koniAmount > user.koniBalance)
      return { ok:false, msg:'Koni insuffisants.' };
    const fcfa = Math.floor(koniAmount * POKO_CONFIG.koni.rate);
    if (fcfa <= 0) return { ok:false, msg:'Montant trop faible.' };
    const now = Date.now();
    const users = this.getUsers();
    const u = users[user.username];
    u.koniBalance -= koniAmount;
    u.balance += fcfa;
    u.lastKoniActivity = Date.now();
    u.transactions.unshift({ id:now, type:'koni_convert', amount:fcfa, label:`⭐ Conversion ${koniAmount} Koni → ${fcfa} FCFA`, date:now, balance:u.balance });
    this.saveUser(u);
    return { ok:true, fcfa, koniLeft: u.koniBalance };
  },

  // ── Auth ─────────────────────────────────
  async register(username, password, email, avatar) {
    const users = this.getUsers();
    if (users[username])     return { ok:false, msg:'Ce pseudo est déjà pris.' };
    if (username.length < 3) return { ok:false, msg:'Pseudo trop court (3 car. min).' };
    if (password.length < 4) return { ok:false, msg:'Mot de passe trop court (4 car. min).' };
    const isEmail = /\S+@\S+\.\S+/.test(email);
    const isPhone = /^\+242\s?0[456789]\s?\d{3}\s?\d{2}\s?\d{2}$/.test(email.trim());
    if (!isEmail && !isPhone) return { ok:false, msg:'Email invalide ou numéro non reconnu (+242 0X XXX XX XX).' };
    const contactNorm = email.replace(/\s/g,'');
    const exists = Object.values(users).find(u => (u.email||'').replace(/\s/g,'') === contactNorm);
    if (exists) return { ok:false, msg:'Ce contact est déjà utilisé.' };
    const now = Date.now();
    const user = {
      username,
      password: btoa(unescape(encodeURIComponent(password))),
      email, avatar: avatar || '🃏',
      createdAt:now, lastLogin:now, lastDailyBonus:null,
      mokeStart:now,
      level:'moke',
      trustScore:15,  // 15% comportement (pas banni)
      totalRecharged:0,
      koniBalance:0, lastKoniActivity:null,
      balance: POKO_CONFIG.welcomeBonus,
      totalGames:0, totalWins:0,
      longestWinStreak:0, currentStreak:0,
      totalEarned:0, totalLost:0,
      banned:false, vip:false,
      history:[],
      transactions:[{
        id:now, type:'bonus', amount:POKO_CONFIG.welcomeBonus,
        label:'🎁 Bonus de bienvenue', date:now, balance:POKO_CONFIG.welcomeBonus
      }]
    };
    users[username] = user;
    this.saveUsers(users);
    this.updatePlayerRTP(user);
    this.setSession({ username });
    return { ok:true, user };
  },

  async login(usernameOrContact, password) {
    const users = this.getUsers();
    const normalized = usernameOrContact.replace(/\s/g,'');
    let user = users[usernameOrContact];
    if (!user) {
      user = Object.values(users).find(u =>
        u.email === usernameOrContact ||
        (u.email||'').replace(/\s/g,'') === normalized
      );
    }
    if (!user) return { ok:false, msg:'Compte introuvable.' };
    if (user.password !== btoa(unescape(encodeURIComponent(password)))) return { ok:false, msg:'Mot de passe incorrect.' };
    if (user.banned) return { ok:false, msg:'Ce compte a été suspendu.' };
    user.lastLogin = Date.now();
    // Recalcul automatique au login
    user.level = this.calculateLevel(user);
    user.trustScore = this.calculateTrustScore(user);
    user = this._checkKoniExpiry(user);
    this.saveUsers(users);
    this.updatePlayerRTP(user);
    this.setSession({ username: user.username });
    return { ok:true, user };
  },

  logout() { this.clearSession(); window.location.href = 'index.html'; },

  // ── Wallet ───────────────────────────────
  async claimDailyBonus() {
    const user = this.currentUser();
    if (!user) return { ok:false };
    const today = new Date().toDateString();
    if (user.lastDailyBonus && new Date(user.lastDailyBonus).toDateString() === today)
      return { ok:false, msg:"Bonus déjà réclamé aujourd'hui." };
    const koniAmount = POKO_CONFIG.dailyBonus;
    const users = this.getUsers();
    const u = users[user.username];
    u.koniBalance = (u.koniBalance || 0) + koniAmount;
    u.lastKoniActivity = Date.now();
    u.lastDailyBonus = Date.now();
    u.transactions.unshift({ id:Date.now(), type:'bonus', amount:0, label:`☀️ Bonus quotidien +${koniAmount} Koni`, date:Date.now(), balance:u.balance });
    this.saveUser(u);
    return { ok:true, koniAmount };
  },

  async updateProfile({ avatar, username, currentPassword, newPassword }) {
    const user = this.currentUser();
    if (!user) return { ok:false, msg:'Non connecté.' };
    const users = this.getUsers();
    const u = users[user.username];
    if (!u) return { ok:false, msg:'Compte introuvable.' };

    // Vérifier le mot de passe actuel si modification sensible
    if (username || newPassword) {
      const encoded = btoa(unescape(encodeURIComponent(currentPassword||'')));
      if (u.password !== encoded) return { ok:false, msg:'Mot de passe actuel incorrect.' };
    }

    // Changer le pseudo
    if (username && username !== user.username) {
      if (username.length < 3) return { ok:false, msg:'Pseudo trop court (3 caractères min).' };
      if (users[username]) return { ok:false, msg:'Ce pseudo est déjà pris.' };
      u.username = username;
      users[username] = u;
      delete users[user.username];
    }

    // Changer le mot de passe
    if (newPassword) {
      if (newPassword.length < 4) return { ok:false, msg:'Mot de passe trop court (4 caractères min).' };
      u.password = btoa(unescape(encodeURIComponent(newPassword)));
    }

    // Changer l'avatar
    if (avatar) u.avatar = avatar;

    this.saveUsers(users);
    this.setSession({ username: u.username });
    return { ok:true, username: u.username };
  },

  async canClaimDaily() {
    const user = this.currentUser();
    if (!user) return false;
    if (!user.lastDailyBonus) return true;
    return new Date(user.lastDailyBonus).toDateString() !== new Date().toDateString();
  },

  async deposit(amount) {
    const user = this.currentUser();
    if (!user || amount <= 0) return { ok:false, msg:'Montant invalide.' };
    const now = Date.now();
    const users = this.getUsers();
    const u = users[user.username];
    u.balance += amount;
    u.totalRecharged = (u.totalRecharged || 0) + amount;
    // Gain Koni
    const { user: uWithKoni, earned: koniEarned } = this.earnKoni(u, amount);
    Object.assign(u, uWithKoni);
    // Recalcul niveau + trust score
    u.level = this.calculateLevel(u);
    u.trustScore = this.calculateTrustScore(u);
    u.transactions.unshift({
      id:now, type:'deposit', amount,
      label:`💳 Dépôt${koniEarned ? ` (+${koniEarned} Koni)` : ''}`,
      date:now, balance:u.balance
    });
    if (u.transactions.length > 100) u.transactions = u.transactions.slice(0,100);
    this.saveUser(u);
    return { ok:true, balance:u.balance, koniEarned, level:u.level, trustScore:u.trustScore };
  },

  async withdraw(amount) {
    const user = this.currentUser();
    if (!user) return { ok:false, msg:'Non connecté.' };
    if (amount <= 0) return { ok:false, msg:'Montant invalide.' };
    if (amount > user.balance) return { ok:false, msg:'Solde insuffisant.' };
    const now = Date.now();
    const users = this.getUsers();
    const u = users[user.username];
    u.balance -= amount;
    u.transactions.unshift({ id:now, type:'withdraw', amount:-amount, label:'🏦 Retrait', date:now, balance:u.balance });
    if (u.transactions.length > 100) u.transactions = u.transactions.slice(0,100);
    this.saveUser(u);
    return { ok:true, balance:u.balance };
  },

  async deductMise(mise) {
    const user = this.currentUser();
    if (!user) return { ok:false };
    if (user.balance < mise) return { ok:false, msg:`Solde insuffisant (${user.balance.toLocaleString('fr-FR')} FCFA disponible).` };
    const users = this.getUsers();
    users[user.username].balance -= mise;
    this.saveUsers(users);
    return { ok:true, balance:users[user.username].balance };
  },

  async recordGame({ mise, result, stage, table }) {
    const user = this.currentUser();
    if (!user) return;
    const now = Date.now();
    const users = this.getUsers();
    const u = users[user.username];
    u.totalGames++;
    let change = 0, label = '';
    if (result === 'win') {
      change = mise * 4;
      u.balance += change;
      u.totalWins++;
      u.totalEarned += change;
      u.currentStreak++;
      if (u.currentStreak > u.longestWinStreak) u.longestWinStreak = u.currentStreak;
      label = `🏆 Victoire — Pot ${(mise*4).toLocaleString('fr-FR')} FCFA`;
      u.transactions.unshift({ id:now, type:'win', amount:change, label, date:now, balance:u.balance });
    } else {
      u.totalLost = (u.totalLost||0) + mise;
      u.currentStreak = 0;
      label = result === 'gameover' ? `💀 Éliminé — Étape ${stage}` : `❌ Défaite — Étape ${stage}`;
      u.transactions.unshift({ id:now, type:'loss', amount:-mise, label, date:now, balance:u.balance });
    }
    // Recalcul RTP après chaque partie
    u.level = this.calculateLevel(u);
    u.trustScore = this.calculateTrustScore(u);
    const entry = { id:now, date:now, mise, result, stage, table:table||'nganda', change, balanceAfter:u.balance, label };
    u.history.unshift(entry);
    if (u.history.length > 50) u.history = u.history.slice(0,50);
    if (u.transactions.length > 100) u.transactions = u.transactions.slice(0,100);
    this.saveUser(u);
    this.updatePlayerRTP(u); // auto-ajustement RTP après chaque partie
    return entry;
  },

  // ── Caisses admin ─────────────────────────
  getCaisses() {
    const users = Object.values(this.getUsers());
    const totalRecharges = users.reduce((s,u) => s + (u.totalRecharged||0), 0);
    const totalGainsPaids = users.reduce((s,u) => s + (u.totalEarned||0), 0);
    const marge = totalRecharges - totalGainsPaids;
    const saved = JSON.parse(localStorage.getItem('poko_caisse') || '{}');
    return {
      acquisition: {
        balance: saved.acquisition || Math.floor(marge * 0.30),
        pct: Math.floor((saved.acquisition || Math.floor(marge * 0.30)) / Math.max(marge,1) * 100),
        label: 'Acquisition'
      },
      retention: {
        balance: saved.retention || Math.floor(marge * 0.40),
        pct: Math.floor((saved.retention || Math.floor(marge * 0.40)) / Math.max(marge,1) * 100),
        label: 'Rétention'
      },
      operations: {
        balance: saved.operations || Math.floor(marge * 0.30),
        pct: Math.floor((saved.operations || Math.floor(marge * 0.30)) / Math.max(marge,1) * 100),
        label: 'Opérations'
      },
      totalRecharges, totalGainsPaids, marge
    };
  },

  // ── Historique / Leaderboard ─────────────
  async getTransactions(username) {
    return (this.getUsers()[username]?.transactions || []).slice(0,50);
  },
  async getGameHistory(username) {
    return (this.getUsers()[username]?.history || []).slice(0,30);
  },
  async leaderboard() {
    return Object.values(this.getUsers())
      .map(u => ({
        username:u.username, avatar:u.avatar||'🃏',
        level:u.level||'moke', levelInfo:this.getLevelInfo(u.level||'moke'),
        totalWins:u.totalWins||0, totalGames:u.totalGames||0,
        totalEarned:u.totalEarned||0,
        winRate:u.totalGames>0?Math.round((u.totalWins/u.totalGames)*100):0,
        longestStreak:u.longestWinStreak||0
      }))
      .sort((a,b)=>b.totalWins-a.totalWins||b.winRate-a.winRate)
      .slice(0,20);
  },
  async getAllUsers() { return Object.values(this.getUsers()); },

  // ── Formatage ────────────────────────────
  formatDate(ts) {
    return new Date(ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  },
  formatAmount(n) {
    return (n>=0?'+':'')+Math.abs(n).toLocaleString('fr-FR')+' FCFA';
  }
};

// ── Guards ──────────────────────────────────
async function requireAuth(to) {
  to = to || 'login.html';
  const session = POKO_DB.getSession();
  if (!session) { window.location.href = to; return false; }
  const users = POKO_DB.getUsers();
  const user = users[session.username];
  if (!user) { POKO_DB.clearSession(); window.location.href = to; return false; }
  if (user.banned) {
    POKO_DB.clearSession();
    alert("Votre compte a été suspendu. Contactez l'administrateur.");
    window.location.href = to;
    return false;
  }
  return true;
}
function requireGuest(to) {
  to = to || 'index.html';
  if (POKO_DB.getSession()) { window.location.href = to; return false; }
  return true;
}

// ── Session activity tracker ─────────────────────────────
// Rafraîchit le timestamp de la session à chaque interaction utilisateur.
// Déclenche aussi une vérification du timeout toutes les 30 secondes.
(()=>{
  const authPages = ['index.html','login.html','register.html','admin-login.html'];
  const page = window.location.pathname.split('/').pop();
  if (authPages.includes(page)) return; // pas de tracker sur les pages publiques

  let _refreshThrottle = null;
  const refresh = () => {
    clearTimeout(_refreshThrottle);
    _refreshThrottle = setTimeout(() => POKO_DB.refreshSession(), 500);
  };
  ['mousedown','mousemove','keydown','scroll','touchstart','click'].forEach(evt => {
    document.addEventListener(evt, refresh, { passive:true });
  });

  // Vérification périodique toutes les 30 secondes
  setInterval(() => { POKO_DB.currentUser(); }, 30000);
})();
