"use client";

import { useEffect, useState } from "react";
import Lottie from "lottie-react";

interface LottieAnimationProps {
  src: string;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
}

export function LottieAnimation({ src, className, loop = true, autoplay = true }: LottieAnimationProps) {
  const [data, setData] = useState<object | null>(null);

  useEffect(() => {
    fetch(src)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [src]);

  if (!data) return null;

  return (
    <Lottie
      animationData={data}
      loop={loop}
      autoplay={autoplay}
      className={className}
    />
  );
}
