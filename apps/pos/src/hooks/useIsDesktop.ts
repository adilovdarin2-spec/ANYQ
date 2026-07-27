import { useEffect, useState } from 'react';

function matches(breakpoint: number): boolean {
  return typeof window !== 'undefined' && document.documentElement.clientWidth >= breakpoint;
}

export function useIsDesktop(breakpoint = 900): boolean {
  const [isDesktop, setIsDesktop] = useState(() => matches(breakpoint));

  useEffect(() => {
    function check() {
      setIsDesktop(matches(breakpoint));
    }
    window.addEventListener('resize', check);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(check);
      observer.observe(document.documentElement);
    }

    return () => {
      window.removeEventListener('resize', check);
      observer?.disconnect();
    };
  }, [breakpoint]);

  return isDesktop;
}
