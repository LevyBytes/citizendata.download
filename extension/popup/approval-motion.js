(() => {
  "use strict";

  // The approval card's motion follows the dashboard hero: artwork that turns slowly and breathes, and a thin
  // field of embers drifting across. It runs only while the card is shown and holds still for reduced motion.
  const card = document.getElementById("approvalView");
  const artwork = document.getElementById("approvalArt");
  const canvas = document.getElementById("approvalEmbers");
  if (!card || !artwork || !canvas) return;
  const context = canvas.getContext("2d", { alpha: true });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const TAU = Math.PI * 2;
  const rotationSeconds = 60;
  const pulseSeconds = 5;
  let width = 1;
  let height = 1;
  let elapsed = 0;
  let previousFrame = null;
  let lastPaint = -Infinity;
  let frame = null;
  let particles = [];

  // A repeatable seed keeps the particle field stable across resizes.
  function seededRandom() {
    let value = 0xC1712E;
    return () => {
      value = (Math.imul(1664525, value) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  // One small reusable glow texture instead of a blur filter on every frame.
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

  function rebuildParticles() {
    const random = seededRandom();
    const count = Math.min(36, Math.max(14, Math.round(width * height / 2600)));
    particles = Array.from({ length: count }, () => ({
      offset: random(),
      lifetime: 7 + random() * 8,
      lane: .06 + random() * .88,
      phase: random() * TAU,
      sway: 4 + random() * 9,
      radius: .4 + random() * .7,
      brightness: .25 + random() * .34,
      trail: 2 + random() * 6
    }));
  }

  function paintEmbers() {
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    for (const particle of particles) {
      const progress = (elapsed / particle.lifetime + particle.offset) % 1;
      const age = progress * particle.lifetime;
      const x = -16 + progress * (width + 32);
      const y = particle.lane * height - progress * 18
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
    // Translation fixes the artwork's center on the card corner; rotation and scaling happen around that center.
    artwork.style.transform = `translate(50%, -50%) rotate(${angle}deg) scale(${scale})`;
  }

  function resize() {
    width = Math.max(1, card.clientWidth);
    height = Math.max(1, card.clientHeight);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    rebuildParticles();
    paintEmbers();
  }

  function shouldAnimate() {
    return !card.hidden && !document.hidden && !reducedMotion.matches;
  }

  function animate(timestamp) {
    frame = null;
    if (!shouldAnimate()) return;
    if (previousFrame !== null) elapsed += Math.min(.1, (timestamp - previousFrame) / 1000);
    previousFrame = timestamp;
    positionArtwork();
    // Artwork follows display frames; the ember layer needs only 30 paints per second.
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
    if (card.hidden) return;
    // A still frame with embers mid-flight, so the card looks the same with motion turned off.
    if (reducedMotion.matches && elapsed === 0) elapsed = 3;
    resize();
    positionArtwork();
    if (shouldAnimate()) frame = window.requestAnimationFrame(animate);
  }

  document.addEventListener("visibilitychange", sync);
  reducedMotion.addEventListener("change", sync);
  new MutationObserver(sync).observe(card, { attributes: true, attributeFilter: ["hidden"] });
  new ResizeObserver(() => { if (!card.hidden) resize(); }).observe(card);
  sync();
})();
