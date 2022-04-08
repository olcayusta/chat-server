export interface Message {
  id: number
  text: string
  creationTime: Date
  roomId: number
  userId: number
  type: string
  user: User
}
