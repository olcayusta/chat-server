import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import fastifyCors from 'fastify-cors';
import { Pool } from 'pg';
import { WebSocket } from 'ws';

// @ts-ignore
const og = require('open-graph')

const fastify = Fastify();

const pool = new Pool({
  port: 5432,
  database: 'qa_app',
  host: 'localhost',
  user: 'postgres',
  password: '123456',
});

const wss = new WebSocket.Server({
  server: fastify.server,
});

fastify.register(fastifyCors);

fastify.get('/graph', async (request: FastifyRequest, reply: FastifyReply) => {
  const url = 'https://www.youtube.com/watch?v=o3mP3mJDL2k'

  og(url, async (err: any, data: any) => {
    if (err) console.log(err)
    console.log(data)
    reply.send(data)
  });
})

fastify.get('/rooms', async (req: FastifyRequest, reply: FastifyReply) => {
  const { rows } = await pool.query(`
      SELECT cr.*, chat_msg.content as "message"
      FROM "chat_room" cr,
           LATERAL (
               SELECT MAX(cm.content) content FROM chat_message cm WHERE cm."roomId" = cr.id
               ) chat_msg
  `);
  return rows;
});

fastify.get(
  '/rooms/:roomId',
  async (req: FastifyRequest, reply: FastifyReply) => {
    const { roomId } = req.params as any;
    const { rows } = await pool.query(
      `
          SELECT cr.id,
                 cr.title,
                 coalesce(
                                 json_agg(
                                 json_build_object(
                                         'id', cm.id,
                                         'text', cm.text,
                                         'type', cm.type,
                                         'user',
                                         (
                                             SELECT json_build_object(
                                                            'id', u.id, 'displayName', u."displayName", 'picture',
                                                            u.picture
                                                        )
                                             FROM "user" u
                                             WHERE u.id = cm."userId"
                                         )
                                     )
                                 ORDER BY cm."creationTime") FILTER ( WHERE cm.id IS NOT NULL )
                     , '[]'::json) AS "messages"
          FROM chat_room cr
                   LEFT JOIN chat_message cm on cr.id = cm."roomId"
          WHERE cr.id = $1
          GROUP BY 1
      `,
      [roomId]
    );
    return rows[0] ?? [];
  }
);

wss.on('connection', async (ws) => {
  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        event: 'something',
      })
    );
  });

  ws.on('message', async (data: string) => {
    console.log(data);
    const { event, payload } = JSON.parse(data);

    const userId = 5;

    // console.log(payload);

    const { rows } = await pool.query(
      `
          WITH cte AS (
              INSERT INTO chat_message ("roomId", "userId", content)
                  VALUES (1, $1, $2)
                  RETURNING id
          )
          SELECT (SELECT id FROM cte),
                 jsonb_build_object('id', u.id, 'displayName', u."displayName", 'picture', u.picture) AS "user"
          FROM "user" u
          WHERE u.id = $1
      `,
      [userId, payload.text]
    );

    wss.clients.forEach((ws) => {
      ws.send(
        JSON.stringify({
          event: 'server message',
          payload: {
            id: rows[0].id,
            text: payload.text,
            type: 'text',
            user: rows[0].user,
          },
        })
      );
    });
  });
});

const start = async () => {
  try {
    await fastify.listen(1234);
    console.log('Uygulama 1234 portundan ayağa kaltı ve çalışıyor...');
  } catch (e) {
    fastify.log.error(e);
    process.exit(1);
  }
};

start();
