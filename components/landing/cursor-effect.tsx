"use client";

import { useEffect, useRef, useState } from "react";

interface RippleEffect {
  id: number;
  x: number;
  y: number;
}

export function CursorEffect() {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const [ripples, setRipples] = useState<RippleEffect[]>([]);
  const trailRef = useRef<{ x: number; y: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const rippleId = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY });
      setIsVisible(true);
      
      // Add to trail
      trailRef.current.push({ x: e.clientX, y: e.clientY });
      if (trailRef.current.length > 20) {
        trailRef.current.shift();
      }
    };

    const handleMouseLeave = () => {
      setIsVisible(false);
      trailRef.current = [];
    };

    const handleClick = (e: MouseEvent) => {
      const id = rippleId.current++;
      setRipples(prev => [...prev, { id, x: e.clientX, y: e.clientY }]);
      
      // Remove ripple after animation
      setTimeout(() => {
        setRipples(prev => prev.filter(r => r.id !== id));
      }, 600);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("click", handleClick);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("click", handleClick);
    };
  }, []);

  // Draw trail on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const trail = trailRef.current;
      if (trail.length < 2) {
        animationRef.current = requestAnimationFrame(draw);
        return;
      }

      // Draw trail with gradient
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      
      for (let i = 1; i < trail.length; i++) {
        ctx.lineTo(trail[i].x, trail[i].y);
      }
      
      const gradient = ctx.createLinearGradient(
        trail[0].x, trail[0].y,
        trail[trail.length - 1].x, trail[trail.length - 1].y
      );
      gradient.addColorStop(0, "rgba(34, 211, 238, 0)");
      gradient.addColorStop(1, "rgba(34, 211, 238, 0.4)");
      
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <>
      {/* Trail canvas */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-[9999]"
        style={{ mixBlendMode: "screen" }}
      />
      
      {/* Cursor glow */}
      {isVisible && (
        <div
          className="pointer-events-none fixed z-[9999] transition-opacity duration-150"
          style={{
            left: position.x,
            top: position.y,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div 
            className="w-6 h-6 rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(34, 211, 238, 0.3) 0%, transparent 70%)",
              filter: "blur(4px)",
            }}
          />
        </div>
      )}
      
      {/* Click ripples */}
      {ripples.map(ripple => (
        <div
          key={ripple.id}
          className="pointer-events-none fixed z-[9999]"
          style={{
            left: ripple.x,
            top: ripple.y,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div 
            className="animate-ripple rounded-full"
            style={{
              width: 0,
              height: 0,
              border: "2px solid rgba(34, 211, 238, 0.6)",
              animation: "ripple 0.6s ease-out forwards",
            }}
          />
        </div>
      ))}
      
      <style jsx global>{`
        @keyframes ripple {
          0% {
            width: 0;
            height: 0;
            opacity: 1;
          }
          100% {
            width: 80px;
            height: 80px;
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}
