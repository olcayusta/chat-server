const fastify = require('fastify')({logger: true})
const cors = require('fastify-cors')
const WebSocket = require('ws')
const pg = require('pg')

const pool = new pg.Pool({
    port: 5432,
    database: 'qa_app',
    host: 'localhost',
    user: 'postgres',
    password: '123456'
})

const wss = new WebSocket.Server({
    server: fastify.server
})

fastify.register(cors)

fastify.get('/rooms/:roomId', async (req, res) => {
    const {roomId} = req.params
    const {rows} = await pool.query(`
        SELECT cr.id,
               cr.title,
               coalesce(
                       jsonb_agg( 
                               jsonb_build_object(
                                       'id', cm.id,
                                       'text', cm.content,
                                       'user',
                                       (
                                           SELECT jsonb_build_object(
                                                          'id', u.id, 'displayName', u."displayName", 'picture',
                                                          u.picture
                                                      )
                                           FROM "user" u
                                           WHERE u.id = cm."userId"
                                       )
                                   )
                           ) FILTER ( WHERE cm.id IS NOT NULL )
                   , '[]'::jsonb) AS "messages"
        FROM chat_room cr
                 LEFT JOIN chat_message cm on cr.id = cm."roomId"
        WHERE cr.id = $1
        GROUP BY 1
    `, [roomId])
    return rows[0] ? rows[0] : []
})

function insertMessage() {

}

wss.on('connection', async (ws) => {
    ws.on('open', () => {
        ws.send(JSON.stringify({
            event: 'something'
        }))
    })

    ws.on('message', async (data) => {
        console.log(data)
        const {event, payload} = JSON.parse(data)
        console.log(event, payload)

        const {rows: messageRows} = await pool.query(`
            INSERT INTO chat_message ("roomId", "userId", content)
            VALUES (1, 5, $1)
            RETURNING *
        `, [payload.text])

        const {rows: userRows} = await pool.query('SELECT id, "displayName", picture FROM "user" u WHERE id = $1', [3])

        ws.send(JSON.stringify({
            event: 'server message',
            payload: {
                id: messageRows[0].id,
                text: payload.text,
                user: userRows[0]
            }
        }))
    })
})

const start = async () => {
    try {
        await fastify.listen(1234)
    } catch (e) {
        fastify.log.error(err)
        process.exit(1)
    }
}

start()
