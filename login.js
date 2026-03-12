function togglePwd(id,btn){const el=document.getElementById(id);if(el.type==="password"){el.type="text";btn.textContent="🙈";}else{el.type="password";btn.textContent="👁";}}

requireGuest();

window.addEventListener('DOMContentLoaded', function() {
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.addEventListener('keydown', e => {
    if(e.key==='Enter' && !document.getElementById('loginBtn').disabled) doLogin();
  });
});

function showErr(msg) {
  const b = document.getElementById('errBox');
  b.textContent = msg;
  b.classList.add('show');
}

async function doLogin() {
  const u = (typeof getLoginIdentifier === 'function') ? getLoginIdentifier() : document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  document.getElementById('errBox').classList.remove('show');
  if(!u||!p) { showErr('Remplis tous les champs.'); return; }
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  document.getElementById('btnTxt').textContent = 'Connexion…';
  document.getElementById('spin').style.display = 'block';
  const r = await POKO_DB.login(u, p);
  if(r.ok) {
    window.location.href = 'index.html';
  } else {
    showErr(r.msg);
    btn.disabled = false;
    document.getElementById('btnTxt').textContent = 'Se connecter';
    document.getElementById('spin').style.display = 'none';
  }
}
