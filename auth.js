// ═══════════════════════════════════════════
//  POKO — auth.js  (Phase 2 — Supabase)
//  Niveaux · Trust Score · Koni · RTP dynamique
// ═══════════════════════════════════════════

// ── CONFIG ─────────────────────────────────
const POKO_CONFIG = {
  tables: [
    { id:'leki',    name:'Leki',    mise:100,  trustMin:0,  icon:'🟢' },
    { id:'yaya',    name:'Yaya',    mise:500,  trustMin:30, icon:'🔵' },
    { id:'mokolo',  name:'Mokolo',  mise:1000, trustMin:60, icon:'🟡' },
    { id:'mokonzi', name:'Mokonzi', mise:2500, trustMin:85, icon:'🔴' },
  ],
  levels: {
    moke:   { name:'Moké',   icon:'🪵', label:'Débutant', rtp:65,   color:'#8B6914' },
    monene: { name:'Monéné', icon:'🔥', label:'Régulier', rtp:null, color:'#E85D04' },
    koni:   { name:'Koni',   icon:'🌟', label:'Confirmé', rtp:null, color:'#6A0DAD' },
    makala: { name:'Makala', icon:'👑', label:'Élite',    rtp:18,   color:'#d4a017' },
  },
  levelThresholds: {
    moke_days: 15,
    monene:    5000,
    koni:      15000,
    makala:    30000,
  },
  koni: {
    perHundredFcfa: 5,
    rate:           0.5,
    expiryDays:     30,
    minConvert:     500,
  },
  welcomeBonus: 200,
  dailyBonus:   50,
};

// ── Cache profil courant ───────────────────
let _profile = null;

// ── Conversion DB (snake_case) → UserObject (camelCase) ──
function _toUser(row) {
  return {
    id:                row.id,
    email:             row.email,
    username:          row.username,
    avatar:            row.avatar            || '🃏',
    balance:           row.balance           || 0,
    koniBalance:       row.koni_balance      || 0,
    totalRecharged:    row.total_recharged   || 0,
    totalEarned:       row.total_earned      || 0,
    totalLost:         row.total_lost        || 0,
    totalGames:        row.total_games       || 0,
    totalWins:         row.total_wins        || 0,
    currentStreak:     row.current_streak    || 0,
    longestWinStreak:  row.longest_win_streak|| 0,
    level:             row.level             || 'moke',
    trustScore:        row.trust_score       || 0,
    mokeStart:         row.moke_start        ? new Date(row.moke_start).getTime() : Date.now(),
    lastKoniActivity:  row.last_koni_activity? new Date(row.last_koni_activity).getTime() : null,
    lastDailyBonus:    row.last_daily_bonus  ? new Date(row.last_daily_bonus).getTime() : null,
    vip:               row.vip               || false,
    banned:            row.banned            || false,
    banReason:         row.ban_reason        || '',
    createdAt:         row.created_at        ? new Date(row.created_at).getTime() : Date.now(),
    transactions:      [],
    history:           [],
  };
}

// ── Conversion UserObject → DB fields ──────
function _toDb(user) {
  const d = {};
  if (user.email             !== undefined) d.email              = user.email;
  if (user.username          !== undefined) d.username           = user.username;
  if (user.avatar            !== undefined) d.avatar             = user.avatar;
  if (user.balance           !== undefined) d.balance            = user.balance;
  if (user.koniBalance       !== undefined) d.koni_balance       = user.koniBalance;
  if (user.totalRecharged    !== undefined) d.total_recharged    = user.totalRecharged;
  if (user.totalEarned       !== undefined) d.total_earned       = user.totalEarned;
  if (user.totalLost         !== undefined) d.total_lost         = user.totalLost;
  if (user.totalGames        !== undefined) d.total_games        = user.totalGames;
  if (user.totalWins         !== undefined) d.total_wins         = user.totalWins;
  if (user.currentStreak     !== undefined) d.current_streak     = user.currentStreak;
  if (user.longestWinStreak  !== undefined) d.longest_win_streak = user.longestWinStreak;
  if (user.level             !== undefined) d.level              = user.level;
  if (user.trustScore        !== undefined) d.trust_score        = user.trustScore;
  if (user.mokeStart         !== undefined) d.moke_start         = new Date(user.mokeStart).toISOString();
  if (user.lastKoniActivity  !== undefined) d.last_koni_activity = user.lastKoniActivity ? new Date(user.lastKoniActivity).toISOString() : null;
  if (user.lastDailyBonus    !== undefined) d.last_daily_bonus   = user.lastDailyBonus   ? new Date(user.lastDailyBonus).toISOString()   : null;
  if (user.vip               !== undefined) d.vip                = user.vip;
  if (user.banned            !== undefined) d.banned             = user.banned;
  if (user.banReason         !== undefined) d.ban_reason         = user.banReason;
  return d;
}

// ── Cache localStorage (compat admin.html) ─
function _cacheUserLocally(user) {
  try {
    const users = JSON.parse(localStorage.getItem('poko_users') || '{}');
    users[user.username] = user;
    localStorage.setItem('poko_users', JSON.stringify(users));
  } catch(e) {}
}

// ══════════════════════════════════════════════════
//  POKO_DB
// ══════════════════════════════════════════════════
const POKO_DB = {

  // ── Logique pure (inchangée) ─────────────

  calculateLevel(user) {
    const tr        = user.totalRecharged || 0;
    const mokeStart = user.mokeStart || user.createdAt || Date.now();
    const daysSince = (Date.now() - mokeStart) / 86400000;
    if (daysSince < POKO_CONFIG.levelThresholds.moke_days && tr < POKO_CONFIG.levelThresholds.monene) return 'moke';
    if (tr >= POKO_CONFIG.levelThresholds.makala) return 'makala';
    if (tr >= POKO_CONFIG.levelThresholds.koni)   return 'koni';
    return 'monene';
  },

  getLevelInfo(level) {
    return POKO_CONFIG.levels[level] || POKO_CONFIG.levels.moke;
  },

  getLevelProgress(user) {
    const tr  = user.totalRecharged || 0;
    const lvl = user.level || 'moke';
    const t   = POKO_CONFIG.levelThresholds;
    if (lvl === 'moke') {
      const days    = (Date.now() - (user.mokeStart || user.createdAt)) / 86400000;
      const pctDays = Math.min(100, (days / t.moke_days) * 100);
      const pctFcfa = Math.min(100, (tr / t.monene) * 100);
      return { pct: Math.max(pctDays, pctFcfa), label:`${tr.toLocaleString('fr-FR')} / ${t.monene.toLocaleString('fr-FR')} FCFA rechargés`, nextLevel:'monene' };
    }
    if (lvl === 'monene') { return { pct: Math.min(100,Math.floor(((tr-t.monene)/(t.koni-t.monene))*100)),   label:`${tr.toLocaleString('fr-FR')} / ${t.koni.toLocaleString('fr-FR')} FCFA`,   nextLevel:'koni'   }; }
    if (lvl === 'koni')   { return { pct: Math.min(100,Math.floor(((tr-t.koni)/(t.makala-t.koni))*100)),     label:`${tr.toLocaleString('fr-FR')} / ${t.makala.toLocaleString('fr-FR')} FCFA`, nextLevel:'makala' }; }
    return { pct:100, label:'Niveau maximum', nextLevel:null };
  },

  calculateTrustScore(user) {
    if (user.vip) return 100;
    const tr         = user.totalRecharged || 0;
    const daysActive = Math.max(1, (Date.now() - (user.createdAt || Date.now())) / 86400000);
    const gpw        = (user.totalGames || 0) / (daysActive / 7);
    let s = { r:0, f:0, a:0, b:0 };
    s.r = tr >= 30000 ? 40 : tr >= 10000 ? 25 : tr >= 5000 ? 15 : Math.floor((tr/5000)*15);
    s.f = gpw >= 20 ? 25 : gpw >= 10 ? 18 : gpw >= 5 ? 12 : Math.floor(Math.min(gpw,5)/5*12);
    s.a = daysActive >= 90 ? 20 : daysActive >= 30 ? 14 : daysActive >= 15 ? 8 : Math.floor((daysActive/15)*8);
    s.b = user.banned ? 0 : 15;
    return Math.min(100, s.r + s.f + s.a + s.b);
  },

  getAccessibleTables(user) {
    const score = user.trustScore || 0;
    return POKO_CONFIG.tables.map(t => ({ ...t, accessible: score >= t.trustMin }));
  },

  getRTP(user) {
    const level = user.level || 'moke';
    if (level === 'moke')   return POKO_CONFIG.levels.moke.rtp   || 65;
    if (level === 'makala') return POKO_CONFIG.levels.makala.rtp || 18;
    const winRate = (user.totalGames || 0) > 0 ? (user.totalWins || 0) / user.totalGames : 0.4;
    if (winRate > 0.60) return 15;
    if (winRate < 0.20) return 35;
    return Math.round(35 - ((winRate - 0.2) / 0.4) * 20);
  },

  updatePlayerRTP(user) {
    (async () => {
      try {
        const { data: row } = await _supabase.from('rtp_settings').select('is_override').eq('player_id', user.id).single();
        if (row && row.is_override) return;
        const rtp = this.getRTP(user);
        await _supabase.from('rtp_settings').upsert({ player_id: user.id, rtp_value: rtp, is_override: false, updated_at: new Date().toISOString() });
        // Cache localStorage pour game.html
        const cache = JSON.parse(localStorage.getItem('poko_rtp') || '{}');
        cache[user.username] = rtp;
        localStorage.setItem('poko_rtp', JSON.stringify(cache));
      } catch(e) {}
    })();
  },

  _checkKoniExpiry(user) {
    if (!user.koniBalance || user.koniBalance <= 0) return user;
    if (!user.lastKoniActivity) return user;
    const daysSince = (Date.now() - user.lastKoniActivity) / 86400000;
    if (daysSince >= POKO_CONFIG.koni.expiryDays) { user.koniBalance = 0; user.lastKoniActivity = null; }
    return user;
  },

  earnKoni(user, depositAmount) {
    const earned = Math.floor(depositAmount / 100) * POKO_CONFIG.koni.perHundredFcfa;
    if (earned <= 0) return { user, earned: 0 };
    user.koniBalance       = (user.koniBalance || 0) + earned;
    user.lastKoniActivity  = Date.now();
    return { user, earned };
  },

  _withFreshData(user) {
    user.level      = this.calculateLevel(user);
    user.trustScore = this.calculateTrustScore(user);
    user = this._checkKoniExpiry(user);
    return user;
  },

  formatDate(ts) {
    return new Date(ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  },
  formatAmount(n) {
    return (n >= 0 ? '+' : '') + Math.abs(n).toLocaleString('fr-FR') + ' FCFA';
  },

  // ── Session ──────────────────────────────

  currentUser() { return _profile; },

  async currentUserAsync() {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) return null;
    const { data: row } = await _supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if (!row || row.banned) return null;
    _profile = this._withFreshData(_toUser(row));
    _cacheUserLocally(_profile);
    return _profile;
  },

  getSession() { return _profile ? { username: _profile.username } : null; },
  setSession() {},
  clearSession() { _profile = null; },
  refreshSession() {},

  _getSessionTimeout() {
    try { const s = JSON.parse(localStorage.getItem('poko_admin_settings') || '{}'); return (s.sessionTimeout || 5) * 60 * 1000; }
    catch(e) { return 5 * 60 * 1000; }
  },

  async logout() {
    await _supabase.auth.signOut();
    _profile = null;
    window.location.href = 'index.html';
  },

  // ── Auth ─────────────────────────────────

  async register(username, password, email, avatar) {
    if (username.length < 3) return { ok:false, msg:'Pseudo trop court (3 car. min).' };
    if (password.length < 4) return { ok:false, msg:'Mot de passe trop court (4 car. min).' };
    const isEmail = /\S+@\S+\.\S+/.test(email);
    const isPhone = /^\+242\s?0[456789]\s?\d{3}\s?\d{2}\s?\d{2}$/.test(email.trim());
    if (!isEmail && !isPhone) return { ok:false, msg:'Email invalide ou numéro non reconnu (+242 0X XXX XX XX).' };

    // Vérifier unicité du pseudo
    const { data: taken } = await _supabase.from('profiles').select('id').eq('username', username).maybeSingle();
    if (taken) return { ok:false, msg:'Ce pseudo est déjà pris.' };

    // Email pour Supabase Auth (convertit téléphone si besoin)
    const authEmail = isEmail ? email : email.replace(/\s/g,'').replace('+','') + '@poko.app';

    const { data: authData, error: authErr } = await _supabase.auth.signUp({ email: authEmail, password });
    if (authErr) {
      if (authErr.message.toLowerCase().includes('already')) return { ok:false, msg:'Ce contact est déjà utilisé.' };
      return { ok:false, msg: authErr.message };
    }

    const now = new Date().toISOString();
    const row = {
      id: authData.user.id, email, username, avatar: avatar || '🃏',
      balance: POKO_CONFIG.welcomeBonus, koni_balance: 0,
      total_recharged: 0, total_earned: 0, total_lost: 0,
      total_games: 0, total_wins: 0, current_streak: 0, longest_win_streak: 0,
      level: 'moke', trust_score: 15, moke_start: now, vip: false, banned: false,
    };

    const { error: profErr } = await _supabase.from('profiles').insert(row);
    if (profErr) return { ok:false, msg:'Erreur création profil : ' + profErr.message };

    // Transaction bonus bienvenue
    await _supabase.from('transactions').insert({
      player_id: authData.user.id, type:'bonus',
      amount: POKO_CONFIG.welcomeBonus, label:'Bonus de bienvenue',
      balance_after: POKO_CONFIG.welcomeBonus,
    });

    // RTP initial
    await _supabase.from('rtp_settings').insert({ player_id: authData.user.id, rtp_value: POKO_CONFIG.levels.moke.rtp || 65, is_override: false });

    const user = this._withFreshData(_toUser(row));
    _profile = user;
    _cacheUserLocally(user);
    return { ok:true, user };
  },

  async login(usernameOrContact, password) {
    const isEmail = /\S+@\S+\.\S+/.test(usernameOrContact);
    const isPhone = /^\+242\s?0[456789]\s?\d{3}\s?\d{2}\s?\d{2}$/.test(usernameOrContact.trim());
    let authEmail = usernameOrContact;

    if (!isEmail && !isPhone) {
      // C'est un pseudo — résolution via RPC (bypass RLS)
      const { data: resolved } = await _supabase.rpc('get_login_email', { p_identifier: usernameOrContact });
      if (!resolved) return { ok:false, msg:'Compte introuvable.' };
      authEmail = resolved;
    } else if (isPhone) {
      authEmail = usernameOrContact.replace(/\s/g,'').replace('+','') + '@poko.app';
    }

    const { data, error } = await _supabase.auth.signInWithPassword({ email: authEmail, password });
    if (error) {
      if (error.message.toLowerCase().includes('invalid')) return { ok:false, msg:'Mot de passe incorrect.' };
      return { ok:false, msg: error.message };
    }

    const { data: row } = await _supabase.from('profiles').select('*').eq('id', data.user.id).single();
    if (!row) return { ok:false, msg:'Profil introuvable.' };
    if (row.banned) return { ok:false, msg:'Ce compte a été suspendu. Contactez l\'administrateur.' };

    const user = this._withFreshData(_toUser(row));
    _profile = user;
    _cacheUserLocally(user);
    this.updatePlayerRTP(user);
    return { ok:true, user };
  },

  // ── Profil ───────────────────────────────

  async saveUser(user) {
    user.level      = this.calculateLevel(user);
    user.trustScore = this.calculateTrustScore(user);
    await _supabase.from('profiles').update(_toDb(user)).eq('id', user.id);
    _profile = user;
    _cacheUserLocally(user);
    this.updatePlayerRTP(user);
  },

  async updateProfile({ avatar, username, currentPassword, newPassword }) {
    const user = this.currentUser();
    if (!user) return { ok:false, msg:'Non connecté.' };

    if (username && username !== user.username) {
      if (username.length < 3) return { ok:false, msg:'Pseudo trop court (3 caractères min).' };
      const { data: taken } = await _supabase.from('profiles').select('id').eq('username', username).maybeSingle();
      if (taken) return { ok:false, msg:'Ce pseudo est déjà pris.' };
    }

    if (newPassword) {
      if (newPassword.length < 4) return { ok:false, msg:'Mot de passe trop court (4 caractères min).' };
      const { error } = await _supabase.auth.updateUser({ password: newPassword });
      if (error) return { ok:false, msg: error.message };
    }

    const updates = {};
    if (avatar)   { updates.avatar   = avatar;   user.avatar   = avatar;   }
    if (username) { updates.username  = username; user.username = username; }
    if (Object.keys(updates).length) {
      await _supabase.from('profiles').update(updates).eq('id', user.id);
    }

    _profile = user;
    _cacheUserLocally(user);
    return { ok:true, username: user.username };
  },

  // ── Wallet ───────────────────────────────

  async claimDailyBonus() {
    const user = this.currentUser();
    if (!user) return { ok:false };
    const today = new Date().toDateString();
    if (user.lastDailyBonus && new Date(user.lastDailyBonus).toDateString() === today)
      return { ok:false, msg:"Bonus déjà réclamé aujourd'hui." };
    const koniAmount = POKO_CONFIG.dailyBonus;
    user.koniBalance       = (user.koniBalance || 0) + koniAmount;
    user.lastKoniActivity  = Date.now();
    user.lastDailyBonus    = Date.now();
    await _supabase.from('profiles').update(_toDb(user)).eq('id', user.id);
    await _supabase.from('transactions').insert({ player_id: user.id, type:'bonus', amount:0, label:`Bonus quotidien +${koniAmount} Koni`, balance_after: user.balance });
    _profile = user;
    _cacheUserLocally(user);
    return { ok:true, koniAmount };
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
    user.balance          += amount;
    user.totalRecharged    = (user.totalRecharged || 0) + amount;
    const { user: u2, earned: koniEarned } = this.earnKoni(user, amount);
    Object.assign(user, u2);
    user.level      = this.calculateLevel(user);
    user.trustScore = this.calculateTrustScore(user);
    await _supabase.from('profiles').update(_toDb(user)).eq('id', user.id);
    await _supabase.from('transactions').insert({ player_id: user.id, type:'recharge', amount, label:`Dépôt${koniEarned ? ` (+${koniEarned} Koni)` : ''}`, balance_after: user.balance });
    _profile = user;
    _cacheUserLocally(user);
    return { ok:true, balance: user.balance, koniEarned, level: user.level, trustScore: user.trustScore };
  },

  async withdraw(amount) {
    const user = this.currentUser();
    if (!user) return { ok:false, msg:'Non connecté.' };
    if (amount <= 0) return { ok:false, msg:'Montant invalide.' };
    if (amount > user.balance) return { ok:false, msg:'Solde insuffisant.' };
    user.balance -= amount;
    await _supabase.from('profiles').update({ balance: user.balance }).eq('id', user.id);
    await _supabase.from('transactions').insert({ player_id: user.id, type:'withdraw', amount:-amount, label:'Retrait', balance_after: user.balance });
    _profile = user;
    _cacheUserLocally(user);
    return { ok:true, balance: user.balance };
  },

  async deductMise(mise) {
    const user = this.currentUser();
    if (!user) return { ok:false };
    if (user.balance < mise) return { ok:false, msg:`Solde insuffisant (${user.balance.toLocaleString('fr-FR')} FCFA disponible).` };
    user.balance -= mise;
    await _supabase.from('profiles').update({ balance: user.balance }).eq('id', user.id);
    _profile = user;
    return { ok:true, balance: user.balance };
  },

  async convertKoni(koniAmount) {
    const user = this.currentUser();
    if (!user) return { ok:false, msg:'Non connecté.' };
    if ((user.koniBalance || 0) < POKO_CONFIG.koni.minConvert) return { ok:false, msg:`Minimum ${POKO_CONFIG.koni.minConvert} Koni pour convertir.` };
    if (koniAmount < POKO_CONFIG.koni.minConvert) return { ok:false, msg:`Minimum ${POKO_CONFIG.koni.minConvert} Koni.` };
    if (koniAmount > user.koniBalance) return { ok:false, msg:'Koni insuffisants.' };
    const fcfa = Math.floor(koniAmount * POKO_CONFIG.koni.rate);
    if (fcfa <= 0) return { ok:false, msg:'Montant trop faible.' };
    user.koniBalance -= koniAmount;
    user.balance     += fcfa;
    user.lastKoniActivity = Date.now();
    await _supabase.from('profiles').update(_toDb(user)).eq('id', user.id);
    await _supabase.from('transactions').insert({ player_id: user.id, type:'koni_convert', amount: fcfa, label:`Conversion ${koniAmount} Koni → ${fcfa} FCFA`, balance_after: user.balance });
    _profile = user;
    _cacheUserLocally(user);
    return { ok:true, fcfa, koniLeft: user.koniBalance };
  },

  // ── Jeu ──────────────────────────────────

  async recordGame({ mise, result, stage, table }) {
    const user = this.currentUser();
    if (!user) return;
    let change = 0, label = '';
    user.totalGames++;
    if (result === 'win') {
      change           = mise * 4;
      user.balance    += change;
      user.totalWins++;
      user.totalEarned += change;
      user.currentStreak++;
      if (user.currentStreak > user.longestWinStreak) user.longestWinStreak = user.currentStreak;
      label = `Victoire — Pot ${(mise*4).toLocaleString('fr-FR')} FCFA`;
    } else {
      user.totalLost    = (user.totalLost || 0) + mise;
      user.currentStreak = 0;
      label = result === 'gameover' ? `Éliminé — Manche ${stage}` : `Défaite — Manche ${stage}`;
    }
    user.level      = this.calculateLevel(user);
    user.trustScore = this.calculateTrustScore(user);
    const rtp       = this.getRTP(user);

    await _supabase.from('profiles').update(_toDb(user)).eq('id', user.id);

    const { data: entry } = await _supabase.from('game_history').insert({
      player_id: user.id, mise, result, stage,
      table_name: table || 'leki', change, balance_after: user.balance, label, rtp_applied: rtp,
    }).select().single();

    await _supabase.from('transactions').insert({
      player_id: user.id, type: result === 'win' ? 'win' : 'loss',
      amount: result === 'win' ? change : -mise, label, balance_after: user.balance,
    });

    _profile = user;
    _cacheUserLocally(user);
    this.updatePlayerRTP(user);
    return entry ? { id: entry.id, date: new Date(entry.played_at).getTime(), mise, result, stage, table: entry.table_name, change, balanceAfter: user.balance, label } : null;
  },

  // ── Données ──────────────────────────────

  async getTransactions(playerIdOrUsername) {
    const id = await this._resolveId(playerIdOrUsername);
    if (!id) return [];
    const { data } = await _supabase.from('transactions').select('*').eq('player_id', id).order('created_at', { ascending:false }).limit(100);
    return (data || []).map(t => ({ id: t.id, type: t.type, amount: t.amount, label: t.label, date: new Date(t.created_at).getTime(), balance: t.balance_after }));
  },

  async getGameHistory(playerIdOrUsername) {
    const id = await this._resolveId(playerIdOrUsername);
    if (!id) return [];
    const { data } = await _supabase.from('game_history').select('*').eq('player_id', id).order('played_at', { ascending:false }).limit(50);
    return (data || []).map(g => ({ id: g.id, date: new Date(g.played_at).getTime(), mise: g.mise, result: g.result, stage: g.stage, table: g.table_name, change: g.change, balanceAfter: g.balance_after, label: g.label }));
  },

  async getAllUsers() {
    const { data } = await _supabase.from('profiles').select('*').order('created_at', { ascending:false });
    return (data || []).map(r => _toUser(r));
  },

  async leaderboard() {
    const { data } = await _supabase.from('profiles').select('username,avatar,level,total_wins,total_games,total_earned,longest_win_streak').order('total_wins', { ascending:false }).limit(20);
    return (data || []).map(u => ({
      username: u.username, avatar: u.avatar || '🃏',
      level: u.level || 'moke', levelInfo: this.getLevelInfo(u.level || 'moke'),
      totalWins: u.total_wins || 0, totalGames: u.total_games || 0,
      totalEarned: u.total_earned || 0,
      winRate: (u.total_games || 0) > 0 ? Math.round(((u.total_wins||0) / u.total_games) * 100) : 0,
      longestStreak: u.longest_win_streak || 0,
    }));
  },

  async getCaisses() {
    const { data: users } = await _supabase.from('profiles').select('total_recharged,total_earned');
    const totalRecharges   = (users||[]).reduce((s,u) => s + (u.total_recharged||0), 0);
    const totalGainsPaids  = (users||[]).reduce((s,u) => s + (u.total_earned||0),    0);
    const marge            = totalRecharges - totalGainsPaids;
    return {
      acquisition: { balance: Math.floor(marge*0.30), label:'Acquisition' },
      retention:   { balance: Math.floor(marge*0.40), label:'Rétention'   },
      operations:  { balance: Math.floor(marge*0.30), label:'Opérations'  },
      totalRecharges, totalGainsPaids, marge,
    };
  },

  // Compatibilité admin.html (lecture localStorage)
  getUsers() {
    try { return JSON.parse(localStorage.getItem('poko_users') || '{}'); } catch(e) { return {}; }
  },
  saveUsers() {},

  // Helper interne
  async _resolveId(playerIdOrUsername) {
    if (!playerIdOrUsername) return _profile?.id || null;
    if (/^[0-9a-f-]{36}$/i.test(playerIdOrUsername)) return playerIdOrUsername;
    const { data } = await _supabase.from('profiles').select('id').eq('username', playerIdOrUsername).maybeSingle();
    return data?.id || null;
  },
};

// ── Guards ──────────────────────────────────
async function requireAuth(to) {
  to = to || 'login.html';
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { window.location.href = to; return false; }
  const { data: row } = await _supabase.from('profiles').select('*').eq('id', session.user.id).single();
  if (!row) { await _supabase.auth.signOut(); window.location.href = to; return false; }
  if (row.banned) {
    await _supabase.auth.signOut();
    alert("Votre compte a été suspendu. Contactez l'administrateur.");
    window.location.href = to;
    return false;
  }
  _profile = POKO_DB._withFreshData(_toUser(row));
  _cacheUserLocally(_profile);
  return true;
}

function requireGuest(to) {
  to = to || 'index.html';
  if (_profile) { window.location.href = to; return false; }
  return true;
}

// ── Init — restaurer la session au chargement ──
(async () => {
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    if (session) {
      const { data: row } = await _supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (row && !row.banned) {
        _profile = POKO_DB._withFreshData(_toUser(row));
        _cacheUserLocally(_profile);
        // Charger les paramètres admin depuis Supabase
        const { data: s } = await _supabase.from('admin_settings').select('*').eq('id',1).single();
        if (s) {
          if (s.rtp_moke          != null) POKO_CONFIG.levels.moke.rtp              = s.rtp_moke;
          if (s.rtp_makala        != null) POKO_CONFIG.levels.makala.rtp            = s.rtp_makala;
          if (s.moke_jours        != null) POKO_CONFIG.levelThresholds.moke_days    = s.moke_jours;
          if (s.seuil_monene      != null) POKO_CONFIG.levelThresholds.monene       = s.seuil_monene;
          if (s.seuil_koni        != null) POKO_CONFIG.levelThresholds.koni         = s.seuil_koni;
          if (s.seuil_makala      != null) POKO_CONFIG.levelThresholds.makala       = s.seuil_makala;
          if (s.welcome_bonus     != null) POKO_CONFIG.welcomeBonus                 = s.welcome_bonus;
          if (s.daily_bonus       != null) POKO_CONFIG.dailyBonus                   = s.daily_bonus;
          if (s.koni_per_100fcfa  != null) POKO_CONFIG.koni.perHundredFcfa          = s.koni_per_100fcfa;
          if (s.koni_rate         != null) POKO_CONFIG.koni.rate                    = s.koni_rate;
          if (s.koni_expiry_days  != null) POKO_CONFIG.koni.expiryDays              = s.koni_expiry_days;
          if (s.koni_min_convert  != null) POKO_CONFIG.koni.minConvert              = s.koni_min_convert;
          localStorage.setItem('poko_admin_settings', JSON.stringify({
            rtpMoke: s.rtp_moke, rtpMakala: s.rtp_makala,
            mokeJours: s.moke_jours, seuilMonene: s.seuil_monene,
            seuilKoni: s.seuil_koni, seuilMakala: s.seuil_makala,
            welcomeBonus: s.welcome_bonus, dailyBonus: s.daily_bonus,
            sessionTimeout: s.session_timeout,
          }));
        }
      }
    }
  } catch(e) {}
})();

// ── Suivi d'activité session ─────────────────
(()=>{
  const authPages = ['index.html','login.html','register.html','admin-login.html'];
  const page = window.location.pathname.split('/').pop();
  if (authPages.includes(page)) return;
  let _t = null;
  const refresh = () => { clearTimeout(_t); _t = setTimeout(() => { if(_profile) _supabase.auth.getSession(); }, 500); };
  ['mousedown','mousemove','keydown','scroll','touchstart','click'].forEach(e => document.addEventListener(e, refresh, { passive:true }));
})();
