import { Channel, Socket } from "phoenix";
import { uuid } from "./utils";

export interface ChannelTopic extends Channel {
  topic: string;
}

export default class Data {
  #socket!: Socket;
  #path: string;
  #channels = new Map<string, Channel>();
  private static instance: Data;

  private constructor() {
    return
  }

  public static set socket_path(socket_path: string) {
    if (!Data.instance) {
      Data.instance = new Data();
    }
    Data.instance.#path = socket_path;
  }

  public static connect(): Socket {
    if (!Data.instance) {
      Data.instance = new Data();
    }

    if(!Data.instance.#path) {
      console.warn("[metrics]: Please set path using `Metrics.socket_path = 'ws://localhost:3000/socket`")
    }

    if(window) {
      Data.instance.#socket = new Socket(Data.instance.#path || 'ws://localhost:3000/socket', {
        params: {
          source_url: window.location.href
        }
      })
      Data.instance.#socket.connect();
    }

    return Data.instance.#socket;
  }

  public static startSession(metadata?: object): Channel {
    const identifier = `session:${uuid()}`;
    const result = Data.instance.#channels.get(identifier);

    if (result) {
      return result;
    }

    const session = Data.instance.#socket.channel(identifier, {...metadata, source_url: window.location.href});

    Data.instance.#channels.set(identifier, session);

    session.join();

    return session;
  }

  public static stopSession(channel: Channel): void {
    const _channel = channel as ChannelTopic;
    const identifier = _channel.topic;
    const session = Data.instance.#channels.get(identifier);

    if (session) {
      session.leave();
      Data.instance.#channels.delete(identifier);
    }
  }
}
