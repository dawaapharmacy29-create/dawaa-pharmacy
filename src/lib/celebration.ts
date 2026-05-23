import { toast } from "sonner";

const COLORS = ["#18d8c4", "#6ff7e8", "#22c55e", "#facc15", "#fb7185", "#60a5fa", "#c084fc"];

function playBeep() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("dawaa_celebration_sound") === "off") return;
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + i * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.08 + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.08);
      osc.stop(ctx.currentTime + i * 0.08 + 0.18);
    });
    setTimeout(() => void ctx.close(), 700);
  } catch {
    // ignore audio restrictions
  }
}

export function triggerCelebration(message = "ممتاز! تم تحقيق إنجاز جديد") {
  if (typeof document === "undefined") return;
  if (localStorage.getItem("dawaa_celebration_effects") !== "off") {
    const count = 46;
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement("span");
      piece.className = "dawaa-confetti-piece";
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.background = COLORS[i % COLORS.length];
      piece.style.animationDelay = `${Math.random() * 350}ms`;
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 2600);
    }
  }
  playBeep();
  toast.success(message, { duration: 4200 });
}
