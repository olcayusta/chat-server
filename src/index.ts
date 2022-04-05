import Fastify, { FastifyReply, FastifyRequest } from 'fastify'
import fastifyCors from 'fastify-cors'
import fastifyEtag from 'fastify-etag'
import fastifyRateLimit from 'fastify-rate-limit'
import { Pool } from 'pg'
import { Server, ServerOptions, WebSocket, WebSocketServer } from 'ws'
import { nanoid } from 'nanoid'
import * as Buffer from 'buffer'

// @ts-ignore
const og = require('open-graph')

const fastify = Fastify()

const pool = new Pool({
  port: 5432,
  database: 'qa_app',
  host: 'localhost',
  user: 'postgres',
  password: '123456'
})

let rooms: Map<string, Set<string>> = new Map<string, Set<string>>()

class WebSocket1 extends WebSocket {
  readonly id!: string

  constructor(props: any) {
    super(props)
    this.id = nanoid()
  }

  join = (room: string) => {
    !rooms.has(room)
      ? rooms.set(room, new Set<string>().add(this.id))
      : rooms.get(room)!.add(this.id)
  }
}

class MyServer extends Server<WebSocket1> {
  constructor(options?: ServerOptions, callback?: () => void) {
    super(options, callback)
  }

  rooms: Map<string, Set<string>> = new Map<string, Set<string>>()
}

/*
const wss = new WebSocketServer<WebSocket1>({
  WebSocket: WebSocket1,
  server: fastify.server,
  // @ts-ignore
  origin: 'http://localhost:4400'
})
*/

const wss = new MyServer({
  WebSocket: WebSocket1,
  server: fastify.server,
  // @ts-ignore
  origin: 'http://localhost:4400'
})

fastify.register(fastifyCors, {
  origin: 'http://localhost:4200'
})
fastify.register(fastifyEtag)
/*fastify.register(fastifyRateLimit, {
  max: 4,
  timeWindow: '1 minute'
})*/

fastify.get('/graph', async (req: FastifyRequest, reply: FastifyReply) => {
  const url = 'https://www.youtube.com/watch?v=o3mP3mJDL2k'

  og(url, async (err: any, data: any) => {
    if (err) console.log(err)
    console.log(data)
    reply.send(data)
  })
})

const roomSchema = {
  response: {
    params: {
      type: 'object',
      properties: {
        id: {
          type: 'integer'
        }
      }
    },
    200: {
      type: 'object',
      properties: {
        id: {
          type: 'integer'
        },
        title: {
          type: 'string'
        },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'integer'
              },
              text: {
                type: 'string'
              },
              type: {
                type: 'string'
              },
              user: {
                type: 'object',
                properties: {
                  id: {
                    type: 'integer'
                  },
                  displayName: {
                    type: 'string'
                  },
                  picture: {
                    type: 'string'
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

const roomListSchema = {
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'integer'
          },
          title: {
            type: 'string'
          },
          type: {
            type: 'string',
            nullable: true
          },
          creationTime: {
            type: 'string',
            format: 'date-time'
          },
          userId: {
            type: 'integer',
            nullable: true
          },
          message: {
            type: 'object',
            nullable: true,
            properties: {
              id: {
                type: 'integer'
              },
              text: {
                type: 'string'
              },
              creationTime: {
                type: 'string',
                format: 'date-time'
              },
              user: {
                type: 'object',
                properties: {
                  id: {
                    type: 'integer'
                  },
                  displayName: {
                    type: 'string'
                  },
                  picture: {
                    type: 'string'
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

fastify.get(
  '/rooms',
  {
    schema: roomListSchema
  },
  async (req: FastifyRequest, reply: FastifyReply) => {
    const text = `
        SELECT cr.id, cr.title, message
        FROM chat_room cr
                 LEFT JOIN LATERAL (
            SELECT jsonb_build_object('id', cm.id, 'text', cm.text, 'creationTime', cm."creationTime", 'user',
                                      (SELECT jsonb_build_object('id', u.id, 'displayName', u."displayName",
                                                                 'picture',
                                                                 u.picture)
                                       FROM "user" u
                                       WHERE u.id = cm."userId")) message
            FROM chat_message cm
            WHERE cm."roomId" = cr.id
            ORDER BY id DESC
                LIMIT 1
    ) cm_lateral
        ON TRUE
    `
    const { rows } = await pool.query(text)
    return rows
  }
)

interface IParams {
  roomId: number
}

fastify.get<{
  Params: IParams
}>(
  '/rooms/:roomId',
  {
    schema: roomSchema
  },
  async ({ params: { roomId } }, reply: FastifyReply) => {
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
                                     ) ORDER BY cm."creationTime") FILTER(WHERE cm.id IS NOT NULL)
                     , '[]' ::json) AS "messages"
          FROM chat_room cr
                   LEFT JOIN chat_message cm on cr.id = cm."roomId"
          WHERE cr.id = $1
          GROUP BY 1
      `,
      [roomId]
    )
    return rows[0] ?? []
  }
)

wss.on('connection', async (ws) => {
  ws.on('message', async (data: Buffer, isBinary) => {
    if (!isBinary) {
      const { event, payload } = JSON.parse(data.toString())
      ws.emit(event, payload)
    }
  })

  ws.on('chat message', async (payload) => {
    const roomId = payload.roomId
    const userId = payload.user.id

    const { rows } = await pool.query(
      `
          WITH cte AS (
          INSERT
          INTO chat_message ("roomId", "userId", content, text)
          VALUES ($3, $1, $2, $2)
              RETURNING id
              )
          SELECT (SELECT id FROM cte),
                 jsonb_build_object('id', u.id, 'displayName', u."displayName", 'picture', u.picture) AS "user"
          FROM "user" u
          WHERE u.id = $1
      `,
      [userId, payload.text, roomId]
    )

    const roomName = `channel${roomId}`

    wss.clients.forEach((client) => {
      if (
        rooms.get(roomName)!.has(client.id) &&
        client !== ws &&
        client.readyState === WebSocket.OPEN
      ) {
        client.send(
          JSON.stringify({
            event: 'server message',
            payload: {
              id: rows[0].id,
              text: payload.text,
              type: 'text',
              user: rows[0].user
            }
          })
        )
      }

      /*    rooms.get(roomName)!.forEach((value) => {
        if (client.id === value && client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              event: 'server message',
              payload: {
                id: rows[0].id,
                text: payload.text,
                type: 'text',
                user: rows[0].user,
              },
            })
          )
        }
      })*/
    })
  })

  ws.on('close', () => {
    rooms.forEach((room) => {
      room.delete(ws.id)
    })

    console.log(rooms)

    // console.log(rooms)
  })

  ws.on('join', (payload) => {
    const { user, roomId } = payload
    const roomName = `channel${roomId}`

    // delete id from old room
    rooms.forEach((room) => {
      if (room.has(ws.id)) {
        room.delete(ws.id)
      }
    })

    !rooms.has(roomName)
      ? rooms.set(roomName, new Set<string>().add(ws.id))
      : rooms.get(roomName)!.add(ws.id)

    console.log(rooms)
  })
})

const start = async () => {
  try {
    await fastify.listen(1234)
    console.log('Uygulama 1234 portundan ayağa kaltı ve çalışıyor...')
  } catch (e) {
    fastify.log.error(e)
    process.exit(1)
  }
}

start()
