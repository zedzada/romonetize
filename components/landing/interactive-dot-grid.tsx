"use client";

import { useEffect, useRef, useCallback } from "react";

export function InteractiveDotGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const animationRef = useRef<number>();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const spacing = 18;
    const baseRadius = 1.2;
    const maxRadius = 4;
    const influenceRadius = 120;
    const { x: mouseX, y: mouseY } = mouseRef.current;

    // Get computed color from CSS
    const isDark = document.documentElement.classList.contains("dark");
    const dotColor = isDark ? "rgba(56, 189, 248, 0.18)" : "rgba(100, 116, 139, 0.25)";
    const hoverColor = isDark ? "rgba(56, 189, 248, 0.6)" : "rgba(56, 189, 248, 0.5)";

    for (let x = 0; x < width; x += spacing) {
      for (let y = 0; y < height; y += spacing) {
        const dx = x - mouseX;
        const dy = y - mouseY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        let radius = baseRadius;
        let color = dotColor;

        if (distance < influenceRadius) {
          const factor = 1 - distance / influenceRadius;
          const easedFactor = factor * factor; // Ease out
          radius = baseRadius + (maxRadius - baseRadius) * easedFactor;
          
          // Blend colors based on proximity
          const alpha = isDark 
            ? 0.18 + (0.6 - 0.18) * easedFactor 
            : 0.25 + (0.5 - 0.25) * easedFactor;
          color = isDark 
            ? `rgba(56, 189, 248, ${alpha})` 
            : `rgba(56, 189, 248, ${alpha})`;
        }

        ctx.beginPath();
        ctx.arc(x * dpr, y * dpr, radius * dpr, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }

    animationRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    
    animationRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-auto"
      style={{
        maskImage: "radial-gradient(ellipse 90% 70% at 50% 40%, black 0%, black 40%, transparent 80%)",
        WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 40%, black 0%, black 40%, transparent 80%)",
      }}
    />
  );
}
