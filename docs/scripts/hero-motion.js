(() => {
  "use strict";

  // The dashboard hero and the Build Status header share one motion: artwork that turns slowly and breathes, fixed
  // on the surface's top right corner, and a thin field of embers drifting across. Each surface runs only while it
  // is on screen.
  const TAU = Math.PI * 2;
  const rotationSeconds = 60;
  const pulseSeconds = 5;

  // A repeatable seed keeps the particle field stable across resizes.
  function seededRandom() {
    let value = 0xC1712E;
    return () => {
      value = (Math.imul(1664525, value) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  // One small reusable glow texture, not a per-frame blur/filter allocation.
  const glow = document.createElement("canvas");
  glow.width = glow.height = 32;
  const glowContext = glow.getContext("2d");
  if (glowContext) {
    const gradient = glowContext.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,231,158,.85)");
    gradient.addColorStop(.16, "rgba(244,189,81,.45)");
    gradient.addColorStop(.45, "rgba(216,150,48,.12)");
    gradient.addColorStop(1, "rgba(216,150,48,0)");
    glowContext.fillStyle = gradient;
    glowContext.fillRect(0, 0, 32, 32);
  }

  // The ember field of the wide hero, and the denser, shorter field of a small surface. The small field is the one
  // the extension popup's approval card uses.
  const HERO_FIELD = Object.freeze({ most: 68, fewest: 28, areaPerEmber: 6500, lifetime: [9, 9], lane: [.08, .84], sway: [5, 13], radius: [.45, .8], trail: [2, 7], margin: 24, rise: 24 });
  const SMALL_FIELD = Object.freeze({ most: 36, fewest: 14, areaPerEmber: 2600, lifetime: [7, 8], lane: [.06, .88], sway: [4, 9], radius: [.4, .7], trail: [2, 6], margin: 16, rise: 18 });

  // Puts the motion on one surface. `place(canvas)` inserts the ember canvas into the surface. With `stillWhenReduced`
  // the surface shows one still frame, embers mid-flight, while the user asks for reduced motion.
  function mount({ surface, artwork, canvasClass, place, field, stillWhenReduced = false }) {
    if (!surface || !artwork) return;
    const canvas = document.createElement("canvas");
    canvas.className = canvasClass;
    canvas.setAttribute("aria-hidden", "true");
    place(canvas);
    const context = canvas.getContext("2d", { alpha: true });
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1;
    let height = 1;
    let elapsed = 0;
    let previousFrame = null;
    let lastPaint = -Infinity;
    let frame = null;
    let visible = false;
    let pageActive = true;
    let particles = [];

    function rebuildParticles() {
      const random = seededRandom();
      const count = Math.min(field.most, Math.max(field.fewest, Math.round(width * height / field.areaPerEmber)));
      particles = Array.from({ length: count }, () => ({
        offset: random(),
        lifetime: field.lifetime[0] + random() * field.lifetime[1],
        lane: field.lane[0] + random() * field.lane[1],
        phase: random() * TAU,
        sway: field.sway[0] + random() * field.sway[1],
        radius: field.radius[0] + random() * field.radius[1],
        brightness: .25 + random() * .34,
        trail: field.trail[0] + random() * field.trail[1]
      }));
    }

    function resize() {
      width = Math.max(1, surface.clientWidth);
      height = Math.max(1, surface.clientHeight);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      rebuildParticles();
      paintEmbers();
    }

    function paintEmbers() {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";
      for (const particle of particles) {
        const progress = (elapsed / particle.lifetime + particle.offset) % 1;
        const age = progress * particle.lifetime;
        const x = -field.margin + progress * (width + field.margin * 2);
        const y = particle.lane * height - progress * field.rise
          + Math.sin(age * .75 + particle.phase) * particle.sway
          + Math.sin(age * 1.35 + particle.phase) * 3;
        const envelope = Math.min(1, progress * 9, (1 - progress) * 6);
        const shimmer = .78 + .22 * Math.sin(elapsed * 1.6 + particle.phase) ** 2;
        const alpha = envelope * particle.brightness * shimmer;
        const dy = Math.cos(age * .75 + particle.phase) * .3;
        context.globalAlpha = alpha * .7;
        if (glowContext) {
          const diameter = 8 + particle.radius * 7;
          context.drawImage(glow, x - diameter / 2, y - diameter / 2, diameter, diameter);
        }
        context.globalAlpha = alpha * .48;
        context.strokeStyle = "#c89540";
        context.lineWidth = particle.radius * .85;
        context.beginPath();
        context.moveTo(x - particle.trail, y - dy);
        context.lineTo(x, y);
        context.stroke();
        context.globalAlpha = alpha;
        context.fillStyle = "#f6d58c";
        context.beginPath();
        context.ellipse(x, y, particle.radius * 1.5, particle.radius * .7, -.12, 0, TAU);
        context.fill();
      }
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
    }

    function positionArtwork() {
      const angle = (elapsed / rotationSeconds * 360) % 360;
      const scale = 1 + .075 * (.5 - .5 * Math.cos(TAU * elapsed / pulseSeconds));
      // Translation fixes the original center; rotation/scaling happen around that center.
      artwork.style.transform = `translate(50%, -50%) rotate(${angle}deg) scale(${scale})`;
    }

    function shouldAnimate() {
      return pageActive && visible && !document.hidden && !(stillWhenReduced && reducedMotion.matches);
    }

    function animate(timestamp) {
      frame = null;
      if (!shouldAnimate()) return;
      if (previousFrame !== null) elapsed += Math.min(.1, (timestamp - previousFrame) / 1000);
      previousFrame = timestamp;
      positionArtwork();
      // Artwork follows display frames; the tiny ember layer needs only 30 paints/second.
      if (timestamp - lastPaint >= 1000 / 30) {
        paintEmbers();
        lastPaint = timestamp;
      }
      frame = window.requestAnimationFrame(animate);
    }

    function sync() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      previousFrame = null;
      const running = shouldAnimate();
      surface.dataset.motionState = running ? "running" : "paused";
      if (stillWhenReduced && reducedMotion.matches && elapsed === 0) elapsed = 3;
      positionArtwork();
      paintEmbers();
      if (running) frame = window.requestAnimationFrame(animate);
    }

    document.addEventListener("visibilitychange", sync);
    if (stillWhenReduced) reducedMotion.addEventListener("change", sync);
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    visibility.observe(surface);
    const sizing = new ResizeObserver(resize);
    sizing.observe(surface);
    window.addEventListener("resize", resize);
    window.addEventListener("pagehide", () => {
      pageActive = false;
      sync();
    });
    window.addEventListener("pageshow", () => { pageActive = true; sync(); });
    resize();
    sync();
  }

  const hero = document.getElementById("overview");
  mount({
    surface: hero,
    artwork: document.getElementById("identityHeroArt"),
    canvasClass: "hero-embers",
    place: (canvas) => hero.insertBefore(canvas, hero.querySelector(".identity-main")),
    field: HERO_FIELD
  });

  const statusHeader = document.getElementById("overlayHeader");
  mount({
    surface: statusHeader,
    artwork: document.getElementById("overlayHeaderArt"),
    canvasClass: "overlay-embers",
    place: (canvas) => statusHeader.insertBefore(canvas, statusHeader.firstChild),
    field: SMALL_FIELD,
    stillWhenReduced: true
  });
})();
