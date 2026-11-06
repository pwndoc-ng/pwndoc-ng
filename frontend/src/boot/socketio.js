import { io } from 'socket.io-client'
import { boot } from 'quasar/wrappers'
import { Loading } from 'quasar'
import { $t } from '@/boot/i18n'
import UserService from '@/services/user'
import Router from '../router'

const socket = io(`${window.location.protocol}//${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}`)

// The server refuses the handshake when the user is not authenticated (token cookie missing or expired,
// e.g. after a computer sleep). In that case socket.io doesn't reconnect by itself (socket.active is false):
// refresh the token cookie and retry while the user is logged in.
const RETRY_DELAY = 5000
function retryConnection() {
  setTimeout(() => {
    if (socket.connected || socket.active || !UserService.isAuth())
      return
    UserService.refreshToken()
    .then(() => socket.connect()) // A new refusal triggers connect_error again
    .catch(() => {
      if (UserService.isAuth()) // Backend unreachable: try again later
        retryConnection()
      else // Session expired (user cleared on refresh token error)
        Router.push('/login')
    })
  }, RETRY_DELAY)
}

socket.on('connect_error', () => {
  if (!socket.active)
    retryConnection()
})

// Connect the socket if it was refused before the user logged in
function connectSocket() {
  if (!socket.connected && !socket.active)
    socket.connect()
}

// Close the socket so that it is not reused with the identity of a previous session
function disconnectSocket() {
  socket.disconnect()
}

export default boot(({ app }) => {
  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') // Closed on purpose (logout)
      return
    Loading.show({
      message: `<i class='material-icons'>wifi_off</i><br /><p>${$t('msg.wrongContactingBackend')}</p>`,
      spinner: null,
      html:true,
      backgroundColor: 'red-10',
      customClass: 'loading-error',
      delay: 5000
    })
  })

  socket.on('connect', () => {
    Loading.hide()
  })

  // Add $socket globally in Vue 3 app
  app.config.globalProperties.$socket = socket
})

// To import it elsewhere without `this.$socket`
export { socket, connectSocket, disconnectSocket }
