import { io } from 'socket.io-client';
import { CONFIG } from 'src/config-global';

const connect = (context: { query: { userId: string } }) => io(CONFIG.site.serverUrl, context);

export default {
  connect,
};
