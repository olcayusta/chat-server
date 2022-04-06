interface Message {
  id: number
  text: string
  creationTime: Date
  roomId: number
  userId: number
  user: User
}
