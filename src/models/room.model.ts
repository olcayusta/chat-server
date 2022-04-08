import { Message } from './message.model'

export interface Room {
  id: number
  title: string
  creationTime: Date
  messages: Message[]
}
