(() => {
  'use strict';

  /* ========================================================================
     CAROUSEL TUNABLE PARAMETERS
     Adjust these constants to customize speed, curvature, and stretch.
     ======================================================================== */
  const CAROUSEL_CONFIG = {
    autoSpeed: 42,           // Pixels per second for continuous auto-rotation
    maxRotateDeg: 40,        // Max inward Y-tilt (degrees) at viewport edges
    maxStretchX: 1.46,       // Max horizontal scale at viewport edges
    maxStretchY: 1.12,       // Max vertical scale at viewport edges
    outwardCurve: 0.42,      // Extra horizontal spacing factor so stretched cards never overlap
    minOpacity: 0.86,        // Minimum opacity at viewport edges
    inertiaDecay: 0.94,      // Momentum damping per frame after drag release
    resumeDelayMs: 1100,     // Idle wait (ms) after drag/key before auto-scroll resumes
    dragThresholdPx: 6,      // Movement threshold to distinguish drag from click
    keyboardStepScale: 0.85  // Fraction of a card step per ArrowLeft/ArrowRight press
  };

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ========================================================================
     1. ACTIVE NAVIGATION HIGHLIGHTING
     ======================================================================== */
  function initActiveNavigation() {
    const navLinks = Array.from(document.querySelectorAll('.nav-link[data-nav]'));
    if (!navLinks.length || !('IntersectionObserver' in window)) return;

    const sectionTargets = [
      { el: document.getElementById('home'), navKey: 'home' },
      { el: document.getElementById('about'), navKey: 'about' },
      { el: document.getElementById('portofolio'), navKey: 'portofolio' },
      ...Array.from(document.querySelectorAll('.project-section')).map((el) => ({
        el,
        navKey: 'portofolio'
      }))
    ].filter((item) => item.el);

    const visibleRatios = new Map();

    function setActiveNav(navKey) {
      navLinks.forEach((link) => {
        const isMatch = link.dataset.nav === navKey;
        link.classList.toggle('is-active', isMatch);
        if (isMatch) {
          link.setAttribute('aria-current', 'page');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibleRatios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
        });

        let bestKey = 'home';
        let bestScore = -1;

        sectionTargets.forEach(({ el, navKey }) => {
          const ratio = visibleRatios.get(el) || 0;
          if (ratio > bestScore) {
            bestScore = ratio;
            bestKey = navKey;
          }
        });

        if (bestScore > 0) {
          setActiveNav(bestKey);
        }
      },
      {
        rootMargin: '-18% 0px -35% 0px',
        threshold: [0, 0.15, 0.35, 0.6]
      }
    );

    sectionTargets.forEach(({ el }) => observer.observe(el));
  }

  /* ========================================================================
     2. SCROLL REVEAL ANIMATIONS
     ======================================================================== */
  function initScrollReveal() {
    const groups = document.querySelectorAll('.reveal-group');
    groups.forEach((group) => {
      const items = group.querySelectorAll('.reveal-item');
      items.forEach((item, index) => {
        item.style.setProperty('--reveal-delay', `${Math.min(index * 75, 300)}ms`);
      });
    });

    const revealItems = document.querySelectorAll('.reveal-item');
    if (!revealItems.length) return;

    if (reducedMotionQuery.matches || !('IntersectionObserver' in window)) {
      revealItems.forEach((item) => item.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          } else {
            entry.target.classList.remove('is-visible');
          }
        });
      },
      {
        rootMargin: '0px 0px -6% 0px',
        threshold: 0.06
      }
    );

    revealItems.forEach((item) => observer.observe(item));
  }

  /* ========================================================================
     3. CURVED INFINITE PORTOFOLIO CAROUSEL
     ======================================================================== */
  function initPortfolioCarousel() {
    const viewport = document.getElementById('portfolio-carousel');
    const track = document.getElementById('carousel-track');
    if (!viewport || !track) return;

    const baseCards = Array.from(track.querySelectorAll('.carousel-card'));
    const baseCount = baseCards.length;
    if (!baseCount) return;

    let cards = [];
    let viewportWidth = 0;
    let cardWidth = 0;
    let gap = 20;
    let step = 280;
    let trackWidth = 0;

    let offset = 0;
    let velocity = 0;
    let isPointerDown = false;
    let isDragging = false;
    let activePointerId = null;
    let dragStartX = 0;
    let lastPointerX = 0;
    let lastPointerTime = 0;
    let movedDistance = 0;
    let suppressNextClick = false;
    let resumeAt = 0;

    let isVisible = true;
    let rafId = 0;
    let lastFrameTime = 0;
    let resizeRaf = 0;

    function getCarouselGap() {
      // Matches CSS --carousel-gap: clamp(20px, 2.5vw, 36px)
      return Math.max(20, Math.min(36, window.innerWidth * 0.025));
    }

    function rebuildClones() {
      // Remove any previous clones before rebuilding for current screen width
      Array.from(track.querySelectorAll('.carousel-card[data-clone="true"]')).forEach((el) => el.remove());

      const sampleWidth = baseCards[0].offsetWidth || 220;
      const computedGap = getCarouselGap();
      const setSpan = (sampleWidth + computedGap) * baseCount;
      const neededSets = Math.max(3, Math.ceil((window.innerWidth * 2.4) / Math.max(setSpan, 1)));

      for (let setIdx = 1; setIdx < neededSets; setIdx += 1) {
        baseCards.forEach((card) => {
          const clone = card.cloneNode(true);
          clone.dataset.clone = 'true';
          clone.setAttribute('aria-hidden', 'true');
          clone.setAttribute('tabindex', '-1');
          track.appendChild(clone);
        });
      }

      cards = Array.from(track.querySelectorAll('.carousel-card'));
    }

    function measureGeometry() {
      // Read un-transformed layout dimensions in one pass before writing transforms
      viewportWidth = viewport.clientWidth || window.innerWidth;
      cardWidth = baseCards[0].offsetWidth || 220;
      gap = getCarouselGap();
      step = cardWidth + gap;
      trackWidth = step * cards.length;
    }

    function normalizeOffset(value) {
      if (trackWidth <= 0) return 0;
      return ((value % trackWidth) + trackWidth) % trackWidth;
    }

    function renderCards() {
      if (!trackWidth || !viewportWidth) return;

      const halfTrack = trackWidth * 0.5;
      const halfViewport = Math.max(viewportWidth * 0.5, 1);

      for (let i = 0; i < cards.length; i += 1) {
        let rawX = (i * step - offset) % trackWidth;
        if (rawX > halfTrack) rawX -= trackWidth;
        if (rawX < -halfTrack) rawX += trackWidth;

        // Normalize distance from center (-1 at left edge, 0 at center, +1 at right edge)
        const signedD = Math.max(-1.25, Math.min(1.25, rawX / halfViewport));
        const absD = Math.abs(signedD);
        const clampedD = Math.min(absD, 1);

        // Smooth easing curve for panoramic cylinder curvature
        const eased = clampedD * clampedD * (1.5 - 0.5 * clampedD);

        const translateX = rawX * (1 + (CAROUSEL_CONFIG.maxStretchX - 1) * CAROUSEL_CONFIG.outwardCurve * eased);
        const rotateY = -signedD * CAROUSEL_CONFIG.maxRotateDeg * Math.min(absD, 1.1);
        const scaleX = 1 + (CAROUSEL_CONFIG.maxStretchX - 1) * eased;
        const scaleY = 1 + (CAROUSEL_CONFIG.maxStretchY - 1) * eased;
        const opacity = 1 - (1 - CAROUSEL_CONFIG.minOpacity) * eased;

        const card = cards[i];
        card.style.transform =
          `translate3d(${translateX.toFixed(2)}px, 0, 0) ` +
          `rotateY(${rotateY.toFixed(2)}deg) ` +
          `scale3d(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)}, 1)`;
        card.style.opacity = opacity.toFixed(3);
        card.style.zIndex = String(Math.round(clampedD * 10) + 1);
      }
    }

    function tick(now) {
      if (!lastFrameTime) lastFrameTime = now;
      const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;

      if (!isDragging) {
        if (Math.abs(velocity) > 0.25) {
          offset = normalizeOffset(offset + velocity * dt * 60);
          velocity *= Math.pow(CAROUSEL_CONFIG.inertiaDecay, dt * 60);
        } else {
          velocity = 0;
          if (!reducedMotionQuery.matches && now >= resumeAt) {
            offset = normalizeOffset(offset + CAROUSEL_CONFIG.autoSpeed * dt);
          }
        }
      }

      renderCards();

      if (isVisible && !document.hidden) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    }

    function startLoop() {
      if (!rafId && isVisible && !document.hidden) {
        lastFrameTime = 0;
        rafId = window.requestAnimationFrame(tick);
      }
    }

    function stopLoop() {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    // Pointer Events (mouse, touch, pen): defer setPointerCapture until actual drag so clicks reach <a> links
    viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      isPointerDown = true;
      isDragging = false;
      activePointerId = e.pointerId;
      velocity = 0;
      dragStartX = e.clientX;
      lastPointerX = e.clientX;
      lastPointerTime = performance.now();
      movedDistance = 0;
      suppressNextClick = false;
    });

    viewport.addEventListener('pointermove', (e) => {
      if (!isPointerDown) return;
      const now = performance.now();
      const dx = e.clientX - lastPointerX;
      const elapsed = Math.max(now - lastPointerTime, 4);

      movedDistance += Math.abs(dx);

      if (!isDragging && movedDistance > CAROUSEL_CONFIG.dragThresholdPx) {
        isDragging = true;
        suppressNextClick = true;
        viewport.classList.add('is-dragging');
        if (!viewport.hasPointerCapture(activePointerId)) {
          viewport.setPointerCapture(activePointerId);
        }
      }

      if (isDragging) {
        offset = normalizeOffset(offset - dx);
        velocity = (-dx / elapsed) * 16;
        renderCards();
      }

      lastPointerX = e.clientX;
      lastPointerTime = now;
    });

    function endDrag(e) {
      if (!isPointerDown) return;
      isPointerDown = false;
      if (isDragging) {
        isDragging = false;
        viewport.classList.remove('is-dragging');
        if (viewport.hasPointerCapture(e.pointerId)) {
          viewport.releasePointerCapture(e.pointerId);
        }
        resumeAt = performance.now() + CAROUSEL_CONFIG.resumeDelayMs;
        window.setTimeout(() => {
          suppressNextClick = false;
        }, 60);
      }
      activePointerId = null;
    }

    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    // Suppress link navigation only after an actual drag; normal clicks smooth-scroll to project
    track.addEventListener('click', (e) => {
      const card = e.target.closest('.carousel-card');
      if (!card) return;

      if (suppressNextClick || movedDistance > CAROUSEL_CONFIG.dragThresholdPx) {
        e.preventDefault();
        suppressNextClick = false;
        movedDistance = 0;
        return;
      }

      const targetId = card.dataset.projectTarget;
      const targetEl = targetId ? document.getElementById(targetId) : null;
      if (targetEl) {
        e.preventDefault();
        targetEl.scrollIntoView({ behavior: reducedMotionQuery.matches ? 'auto' : 'smooth' });
      }
    });

    // Keyboard navigation when carousel container is focused
    viewport.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        velocity = 0;
        offset = normalizeOffset(offset + step * CAROUSEL_CONFIG.keyboardStepScale);
        resumeAt = performance.now() + CAROUSEL_CONFIG.resumeDelayMs;
        renderCards();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        velocity = 0;
        offset = normalizeOffset(offset - step * CAROUSEL_CONFIG.keyboardStepScale);
        resumeAt = performance.now() + CAROUSEL_CONFIG.resumeDelayMs;
        renderCards();
      }
    });

    // Pause loop when out of view or tab is hidden
    if ('IntersectionObserver' in window) {
      const visibilityObserver = new IntersectionObserver(
        (entries) => {
          isVisible = entries[0] ? entries[0].isIntersecting : true;
          if (isVisible) {
            startLoop();
          } else {
            stopLoop();
          }
        },
        { rootMargin: '120px 0px' }
      );
      visibilityObserver.observe(viewport);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopLoop();
      } else {
        startLoop();
      }
    });

    // Recalculate dimensions on next frame after resize / orientation change so clamp() has settled
    function handleResize() {
      if (resizeRaf) window.cancelAnimationFrame(resizeRaf);
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = 0;
        rebuildClones();
        measureGeometry();
        offset = normalizeOffset(offset);
        renderCards();
      });
    }

    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => handleResize());
      ro.observe(viewport);
      ro.observe(baseCards[0]);
    } else {
      window.addEventListener('resize', handleResize, { passive: true });
    }

    // Initialize: center card 3 (Eden Farm) or card 1 neatly at start
    rebuildClones();
    measureGeometry();
    offset = normalizeOffset(step * 2);
    renderCards();
    startLoop();
  }

  /* ========================================================================
     4. AUTO-PLAYING PROJECT VIDEOS (PAUSE WHEN OFF-SCREEN)
     ======================================================================== */
  function initProjectVideos() {
    const videos = Array.from(document.querySelectorAll('.project-video'));
    if (!videos.length) return;

    const blockedVideos = new Set();

    function tryPlay(video) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          blockedVideos.add(video);
        });
      }
    }

    if ('IntersectionObserver' in window) {
      const videoObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const video = entry.target;
            if (entry.isIntersecting) {
              tryPlay(video);
            } else {
              video.pause();
            }
          });
        },
        { rootMargin: '220px 0px' }
      );

      videos.forEach((video) => videoObserver.observe(video));
    } else {
      videos.forEach((video) => tryPlay(video));
    }

    // Retry playback on first user interaction if browser initially blocked autoplay
    function retryBlockedVideos() {
      if (!blockedVideos.size) return;
      blockedVideos.forEach((video) => {
        tryPlay(video);
      });
      blockedVideos.clear();
    }

    window.addEventListener('pointerdown', retryBlockedVideos, { once: true, passive: true });
    window.addEventListener('keydown', retryBlockedVideos, { once: true, passive: true });
  }

  /* ========================================================================
     5. SUBTLE SEAM-SAFE BACKGROUND PARALLAX
     ======================================================================== */
  function initParallaxLayers() {
    const layers = Array.from(document.querySelectorAll('[data-parallax]'));
    if (!layers.length || reducedMotionQuery.matches) return;

    let ticking = false;

    function updateParallax() {
      ticking = false;
      const scrollY = window.scrollY || window.pageYOffset;

      // Read parent bounds first, then write clamped translate3d
      const updates = layers.map((layer) => {
        const parent = layer.parentElement;
        const rect = parent ? parent.getBoundingClientRect() : layer.getBoundingClientRect();
        const factor = parseFloat(layer.dataset.parallax) || 0;
        const centerOffset = rect.top + rect.height * 0.5 - window.innerHeight * 0.5;
        const shift = Math.max(-18, Math.min(18, -centerOffset * factor));
        return { layer, shift, scrollY };
      });

      updates.forEach(({ layer, shift }) => {
        layer.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
      });
    }

    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(updateParallax);
        }
      },
      { passive: true }
    );

    updateParallax();
  }

  /* ========================================================================
     6. THUMBNAIL LIGHTBOX VIEWER
     ======================================================================== */
  function initLightbox() {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');
    const thumbButtons = Array.from(document.querySelectorAll('.thumb-btn'));

    if (!lightbox || !lightboxImg || !lightboxCaption || !thumbButtons.length) return;

    let activeGroup = [];
    let activeIndex = 0;
    let lastTrigger = null;

    function showSlide(index) {
      if (!activeGroup.length) return;
      activeIndex = (index + activeGroup.length) % activeGroup.length;
      const btn = activeGroup[activeIndex];
      lightboxImg.src = btn.dataset.lightboxSrc || '';
      lightboxImg.alt = btn.dataset.lightboxAlt || '';
      lightboxCaption.textContent = btn.dataset.lightboxAlt || '';
    }

    function openLightbox(triggerBtn) {
      const groupName = triggerBtn.dataset.lightboxGroup;
      activeGroup = thumbButtons.filter((btn) => btn.dataset.lightboxGroup === groupName);
      activeIndex = Math.max(0, activeGroup.indexOf(triggerBtn));
      lastTrigger = triggerBtn;

      showSlide(activeIndex);
      lightbox.hidden = false;
      document.body.style.overflow = 'hidden';

      const closeBtn = lightbox.querySelector('.lightbox-close');
      if (closeBtn) closeBtn.focus();
    }

    function closeLightbox() {
      if (lightbox.hidden) return;
      lightbox.hidden = true;
      lightboxImg.src = '';
      document.body.style.overflow = '';
      if (lastTrigger) {
        lastTrigger.focus();
        lastTrigger = null;
      }
    }

    thumbButtons.forEach((btn) => {
      btn.addEventListener('click', () => openLightbox(btn));
    });

    lightbox.addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-lightbox-close')) {
        closeLightbox();
      }
    });

    if (prevBtn) {
      prevBtn.addEventListener('click', () => showSlide(activeIndex - 1));
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => showSlide(activeIndex + 1));
    }

    document.addEventListener('keydown', (e) => {
      if (lightbox.hidden) return;
      if (e.key === 'Escape') {
        closeLightbox();
      } else if (e.key === 'ArrowLeft') {
        showSlide(activeIndex - 1);
      } else if (e.key === 'ArrowRight') {
        showSlide(activeIndex + 1);
      }
    });
  }

  /* ========================================================================
     BOOTSTRAP
     ======================================================================== */
  document.addEventListener('DOMContentLoaded', () => {
    initActiveNavigation();
    initScrollReveal();
    initPortfolioCarousel();
    initProjectVideos();
    initParallaxLayers();
    initLightbox();
  });
})();
