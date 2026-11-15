import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const DEFAULT_FILM_VOLUME = 0.35;

export interface LandingCinemaStageProps {
  gmailEnabled: boolean;
  playbackSuspended: boolean;
}

function applyPreferredAudio(video: HTMLVideoElement): void {
  video.defaultMuted = false;
  video.muted = false;
  video.volume = DEFAULT_FILM_VOLUME;
}

export function LandingCinemaStage({ gmailEnabled, playbackSuspended }: LandingCinemaStageProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inViewRef = useRef(false);
  const userPausedRef = useRef(false);
  const blockedUnmutedRef = useRef(false);
  const playbackSuspendedRef = useRef(playbackSuspended);
  const [isPlaying, setIsPlaying] = useState(false);

  const tryPlayWithAudio = useCallback((video: HTMLVideoElement) => {
    if (playbackSuspendedRef.current) return;
    applyPreferredAudio(video);
    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === 'function') {
      playAttempt.catch((err: unknown) => {
        if (playbackSuspendedRef.current || videoRef.current !== video) return;
        if (
          err &&
          typeof err === 'object' &&
          'name' in err &&
          (err as { name?: string }).name === 'NotAllowedError'
        ) {
          blockedUnmutedRef.current = true;
          video.muted = true;
          const fallback = video.play();
          if (fallback && typeof fallback.catch === 'function') {
            fallback.catch(() => {});
          }
        }
      });
    }
  }, []);

  useLayoutEffect(() => {
    playbackSuspendedRef.current = playbackSuspended;
    const video = videoRef.current;
    if (!video) return;
    if (playbackSuspended) {
      if (!video.paused) video.pause();
    } else if (inViewRef.current && !userPausedRef.current && video.paused) {
      tryPlayWithAudio(video);
    }
  }, [playbackSuspended, tryPlayWithAudio]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    applyPreferredAudio(video);

    const handleUserActivation = () => {
      if (playbackSuspendedRef.current || !blockedUnmutedRef.current) return;
      blockedUnmutedRef.current = false;
      applyPreferredAudio(video);
      if (inViewRef.current && !userPausedRef.current && video.paused) {
        const resume = video.play();
        if (resume && typeof resume.catch === 'function') {
          resume.catch(() => {});
        }
      }
    };

    window.addEventListener('pointerdown', handleUserActivation, { capture: true });
    window.addEventListener('keydown', handleUserActivation, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', handleUserActivation, { capture: true });
      window.removeEventListener('keydown', handleUserActivation, { capture: true });
    };
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    const video = videoRef.current;
    if (!section || !video || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        inViewRef.current = entry.isIntersecting;
        if (entry.isIntersecting) {
          if (!userPausedRef.current) {
            tryPlayWithAudio(video);
          }
        } else if (!video.paused) {
          video.pause();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [tryPlayWithAudio]);

  const handleSurfaceToggle = useCallback(() => {
    const video = videoRef.current;
    if (!video || playbackSuspendedRef.current) return;
    if (video.paused) {
      userPausedRef.current = false;
      blockedUnmutedRef.current = false;
      applyPreferredAudio(video);
      const resume = video.play();
      if (resume && typeof resume.catch === 'function') {
        resume.catch(() => {});
      }
    } else if (blockedUnmutedRef.current || video.muted) {
      blockedUnmutedRef.current = false;
      userPausedRef.current = false;
      applyPreferredAudio(video);
    } else {
      userPausedRef.current = true;
      video.pause();
    }
  }, []);

  const filmDescription = gmailEnabled
    ? 'Video minh họa trọn vẹn một quy trình Planora qua Gmail, Slack và Trello'
    : 'Video minh họa trọn vẹn một quy trình Planora liên dịch vụ kèm biên nhận';

  return (
    <section
      ref={sectionRef}
      id="product-film"
      data-testid="product-film-section"
      data-od-id="product-film"
      aria-label="Video thực tế sản phẩm Planora"
      className="pl-cinema-band"
    >
      <div className="pl-wrap">
        <div
          data-testid="landing-film-shell"
          className="pl-film-frame"
        >
          <video
            ref={videoRef}
            data-testid="landing-product-video"
            className="pl-film-video"
            poster="/videos/planora-workflow-poster.png"
            disablePictureInPicture
            disableRemotePlayback
            muted={false}
            loop
            playsInline
            preload="auto"
            aria-hidden="true"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          >
            <source src="/videos/planora-workflow.webm" type="video/webm" />
            <source src="/videos/planora-workflow.mp4" type="video/mp4" />
          </video>
          <button
            type="button"
            data-testid="landing-film-surface"
            className="pl-film-surface"
            aria-pressed={isPlaying}
            aria-label={filmDescription}
            onClick={handleSurfaceToggle}
          />
        </div>
      </div>
    </section>
  );
}
