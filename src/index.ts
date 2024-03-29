import { Channel } from 'phoenix';
import Data from './data';
import Logger from './logger';

enum NativeEvents {
  DURATIONCHANGE = "durationchange",
  LOADEDMETADATA = "loadedmetadata",
  TIMEUPDATE = "timeupdate",
  LOADEDDATA = "loadeddata",
  CANPLAY = "canplay",
  CANPLAYTHROUGH = "canplaythrough",
  SEEKED = "seeked",
  RATECHANGE = "ratechange",
  VOLUMECHANGE = "volumechange",
  PLAYING = 'playing',
  ENDED = 'ended',
  PLAY = 'play',
  PAUSE = 'pause',
  ERROR = 'error',
}

interface Hls {
  media: HTMLMediaElement | null;
}

/**
 * The `Metrics` class is the core of Metrics used for monitoring video events.
 */
export class Metrics {
  VERSION = '__buildVersion';
  querySelectorable?: string;
  hls?: Hls;
  identifier?: string;
  metadata?: object;
  session_data?: object;

  timeout = 10000;

  #video!: HTMLVideoElement;
  #session!: Channel;

  rebuffering = false;
  lastLastTimeupdateCurrentTime = 0;
  lastTimeupdateCurrentTime = 0;
  lastCurrentTime = 0;
  bufferInterval?: ReturnType<typeof setInterval>;
  bufferTimeInterval = 50;
  bufferOffset = (this.bufferTimeInterval - 40) / 1000;

  selectedLanguageVTT?: string;
  fullscreen = false;

  #resizeObserver?: ResizeObserver;
  #monitoring = false;

  /**
   * The `Metrics` class is the core of Metrics used for monitoring video events.
   * @param querySelectorable - A valid query selector to a HTMLVideoElement.
   * @param identifier - A unique identifier for the session.
   * @param metadata - Additional video metadata.
   * @param session - Additional metadata to be sent with the session.
   */
  public constructor(
    querySelectorable: string,
    identifier: string,
    metadata?: object,
    session?: object
  );

  /**
   * The `Metrics` class is the core of Metrics used for monitoring video events.
   * @param videoElement - The actual HTMLMediaElement/HTMLVideoElement.
   * @param identifier - A unique identifier for the session.
   * @param metadata - Additional video metadata.
   * @param session - Additional metadata to be sent with the session.
   */
  public constructor(
    videoElement: HTMLMediaElement | HTMLVideoElement,
    identifier: string,
    metadata?: object,
    session?: object
  );

  /**
   * Overload for hls.js
   * @param hls - A valid hls.js instance.
   * @param identifier - A unique identifier for the session.
   * @param metadata - Additional video metadata.
   * @param session - Additional metadata to be sent with the session.
   */
  public constructor(
    hls: Hls,
    identifier: string,
    metadata?: object,
    session?: object
  );

  public constructor(...args: Array<unknown>) {
    if (args.length <= 1) {
      Logger.error(
        'Metrics requires at least two arguments: querySelectorable and identifier or hls and identifier.'
      );
    } else {
      if (typeof args[0] === 'string') {
        this.querySelectorable = args[0];
        this.identifier = args[1] as string;
      }

      if (
        args[0] instanceof HTMLVideoElement ||
        args[0] instanceof HTMLMediaElement
      ) {
        this.#video = args[0] as HTMLVideoElement;
        this.identifier = args[1] as string;
      } else if (typeof args[0] === 'object') {
        this.hls = args[0] as Hls;
        this.identifier = args[1] as string;
      }

      if (args[2]) {
        this.metadata = args[2] as object;
      }

      if (args[3]) {
        this.session_data = args[3] as object;
      }
    }
  }

  /**
   * Static method to set config.
   */
  public static set config(config: { apiKey: string; socketPath: string }) {
    Data.config = config;
  }

  /**
   * Starts actual monitoring.
   */
  monitor(): Metrics {
    const video = this.querySelectorable
      ? document.querySelector(this.querySelectorable)
      : this.hls?.media;

    if(this.#monitoring) return this;

    if (video || this.#video) {
      if (!this.#video) this.#video = video as HTMLVideoElement;
      this.#session = this.#initiateSession(this.#video);

      this.#recordSession();
      this.#monitorTracks();

      if (window && !this.#resizeObserver) {
        this.#resizeObserver = new ResizeObserver(
          this.#fullscreenChange.bind(this)
        );
        this.#resizeObserver.observe(this.#video);
      }
      this.#monitoring = true;
    } else {
      Logger.error(
        `${this.querySelectorable} is not a valid reference to a HTMLVideoElement.`
      );
    }

    return this;
  }

  demonitor(): void {
    if(!this.#monitoring) return;
    
    this.#resizeObserver?.unobserve(this.#video);
    this.#unrecordSession();
    
    if (this.#session && this.#video) {
      Data.stopSession(this.#video);
    }
  }

  #monitorTracks(): void {
    const tracks = this.#video.textTracks;

    if (tracks) {
      for (const track of tracks) {
        track.addEventListener('cuechange', this.#trackCueChange.bind(this));
      }
    }
  }

  #monitorSource(): void {
    const lastSource = this.#video.currentSrc;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'src' &&
          lastSource !== this.#video.currentSrc
        ) {
          sendSource();
        }
      });
    });

    observer.observe(this.#video, {
      attributeFilter: ['src'],
      attributeOldValue: true,
      subtree: true,
    });

    const sendSource = () => {
      const source_url = this.#video.currentSrc;

      if (!source_url) return;

      this.#session?.push(
        'event',
        {
          name: 'source_set',
          timestamp: new Date().getTime(),
          source_url,
        },
        this.timeout
      );
    };

    sendSource();
  }

  #tapIntoHls(): void {
    if (this.hls) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.hls.on(window.Hls.Events.LEVEL_SWITCHING, (_event: Event, data) => {
        const params = {
          name: 'source_set',
          timestamp: new Date().getTime(),
          width: data.width,
          height: data.height,
          bitrate: data.bitrate,
          codec: data.videoCodec,
          source_url: data.uri,
        };
        this.#session?.push('event', params, this.timeout);
      });
    }
  }

  #trackCueChange(event: Event) {
    const track = event.target as TextTrack;
    const cues = track?.activeCues;

    if (cues?.length) {
      const cue = cues[0] as VTTCue;
      const selectedLanguage = cue.track?.language;
      if (selectedLanguage && this.selectedLanguageVTT !== selectedLanguage) {
        this.#session?.push(
          'event',
          {
            name: 'track_set',
            timestamp: new Date().getTime(),
            language: selectedLanguage,
          },
          this.timeout
        );

        this.selectedLanguageVTT = selectedLanguage;
      }
    }
  }

  #initiateSession(video: HTMLVideoElement): Channel {
    Data.connect();
    return Data.startSession(video, {
      identifier: this.identifier,
      metadata: this.metadata,
      session_data: this.session_data,
    });
  }

  #sendSessionData() {
    Logger.log(`Joined session ${this.identifier}`);
  }

  #recordSession() {
    for (const event of Object.values(NativeEvents)) {
      this.#video.addEventListener(event, this.#recordEvent.bind(this));
    }
  }

  #unrecordSession() {
    for (const event of Object.values(NativeEvents)) {
      this.#video.removeEventListener(event, this.#recordEvent.bind(this));
    }
  }

  #recordEvent(event: Event) {
    const params = {
      name: event.type,
      timestamp: new Date().getTime(),
    };

    switch (event.type) {
      case NativeEvents.PLAY:
        this.#session?.push(
          'event',
          {
            ...params,
            from: this.#video?.currentTime,
          },
          this.timeout
        );

        this.bufferInterval = setInterval(
          this.#checkBuffering.bind(this),
          this.bufferTimeInterval
        );

        break;
      case NativeEvents.PAUSE:
        this.#session?.push(
          'event',
          {
            ...params,
            to: this.#video?.currentTime,
          },
          this.timeout
        );

        this.#checkBuffering();
        clearInterval(this.bufferInterval);
        break;

      case NativeEvents.TIMEUPDATE:
        this.lastLastTimeupdateCurrentTime = this.lastTimeupdateCurrentTime;
        this.lastTimeupdateCurrentTime = this.#video?.currentTime;
        break;
      case NativeEvents.ERROR:
        this.#session?.push(
          'event',
          {
            ...params,
            name: 'playback_failure',
          },
          this.timeout
        );
        break;
      case NativeEvents.SEEKED:
        if(!this.#video?.paused) {
          this.#session?.push(
            'event',
            {
              ...params,
              name: 'pause',
              to: this.lastLastTimeupdateCurrentTime,
            },
            this.timeout
          );

          this.#session?.push(
            'event',
            {
              ...params,
              name: 'play',
              from: this.#video?.currentTime,
            },
            this.timeout
          );
        }


        this.#session?.push(
          'event',
          params,
          this.timeout
        );
        break;
    }
  }

  #checkBuffering() {
    const stalled =
      this.#video?.currentTime < this.lastCurrentTime + this.bufferOffset;

    if (!this.#video?.paused && stalled && !this.rebuffering) {
      this.rebuffering = true;
      this.#session?.push('event', {
        name: 'rebuffering_start',
        from: this.#video?.currentTime,
        timestamp: new Date().getTime(),
      });
    }

    if (!stalled && this.rebuffering) {
      this.rebuffering = false;
      this.#session?.push('event', {
        name: 'rebuffering_end',
        timestamp: new Date().getTime(),
      });
    }

    this.lastCurrentTime = this.#video?.currentTime;
  }

  #fullscreenChange() {
    if (window.innerHeight == screen.height && !this.fullscreen) {
      const timestamp = new Date().getTime();
      this.fullscreen = true;
      this.#session?.push(
        'event',
        {
          name: 'fullscreen_enter',
          timestamp,
        },
        this.timeout
      );
    }

    if (window.innerHeight != screen.height && this.fullscreen) {
      const timestamp = new Date().getTime();
      this.fullscreen = false;
      this.#session?.push(
        'event',
        {
          name: 'fullscreen_exit',
          timestamp,
        },
        this.timeout
      );
    }
  }
}
