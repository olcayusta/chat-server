import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
// @ts-ignore
const og = require('open-graph')

export default async function (fastify: FastifyInstance) {
  fastify.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = 'https://www.youtube.com/watch?v=o3mP3mJDL2k'

    og(url, async (err: any, data: any) => {
      if (err) console.log(err)
      console.log(data)
      reply.send(data)
    })
  })
}
