// === STEP 3 - ERYX0 Smooth Flow + Perfect Android Stability ===
(function(){
  // 1. Fix 100vh issue on Android - use 100dvh
  function setVH(){
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }
  setVH();
  window.addEventListener('resize', setVH);
  window.addEventListener('orientationchange', setVH);

  // 2. Prevent horizontal scroll bounce & double-tap zoom on Android
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function(e){
    const now = Date.now();
    if(now - lastTouchEnd <= 300){ e.preventDefault(); }
    lastTouchEnd = now;
  }, {passive:false});

  // 3. Make stories and tabs scroll with momentum
  document.querySelectorAll('.stories, .tabs, .modeSwitch').forEach(el=>{
    el.style.scrollBehavior = 'smooth';
    // Drag to scroll on desktop
    let isDown=false, startX, scrollLeft;
    el.addEventListener('mousedown', (e)=>{ isDown=true; el.classList.add('dragging'); startX=e.pageX-el.offsetLeft; scrollLeft=el.scrollLeft; });
    el.addEventListener('mouseleave', ()=>{ isDown=false; el.classList.remove('dragging'); });
    el.addEventListener('mouseup', ()=>{ isDown=false; el.classList.remove('dragging'); });
    el.addEventListener('mousemove', (e)=>{ if(!isDown) return; e.preventDefault(); const x=e.pageX-el.offsetLeft; const walk=(x-startX)*1.5; el.scrollLeft=scrollLeft-walk; });
  });

  // 4. Smooth tab switch - scroll active tab into center
  window.smoothOpenTab = function(tabId, btn){
    const target = document.getElementById(tabId);
    if(!target) return;
    // Add smooth class
    target.style.animation = 'none';
    target.offsetHeight; // trigger reflow
    target.style.animation = 'smoothFadeUp 0.25s ease';
    // Scroll button into view
    if(btn && btn.scrollIntoView){
      btn.scrollIntoView({behavior:'smooth', block:'nearest', inline:'center'});
    }
  };

  // 5. Bottom nav - hide on scroll down, show on scroll up (Android style)
  let lastScroll = 0;
  const bottomNav = document.querySelector('.bNav, .bottomNav, .bottom-nav');
  if(bottomNav){
    window.addEventListener('scroll', ()=>{
      const current = window.pageYOffset;
      if(current > lastScroll && current > 100){
        bottomNav.style.transform = 'translateY(100%)';
        bottomNav.style.transition = 'transform 0.3s ease';
      }else{
        bottomNav.style.transform = 'translateY(0)';
      }
      lastScroll = current;
    }, {passive:true});
  }

  // 6. Register Service Worker for stability (PWA)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }

  // 7. Fix for Firebase app - ensure app height perfect
  document.addEventListener('DOMContentLoaded', ()=>{
    const app = document.getElementById('app');
    if(app){
      app.style.minHeight = 'calc(var(--vh, 1vh) * 100)';
    }
  });

  console.log('ERYX0 Perfect Fix Loaded - Smooth + Android Stable');
})();
