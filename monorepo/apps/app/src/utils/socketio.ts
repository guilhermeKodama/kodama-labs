import { io } from 'socket.io-client';
import { CONFIG } from 'src/config-global';

const connect = (context: { query: { userId: string } }) => {
  return io(CONFIG.site.serverUrl, context);
};

export default {
  connect,
};
