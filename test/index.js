'use strict'
const { randomBytes } = require('crypto')
const { promisify } = require('util')
const net = require('net')
const dgram = require('dgram')
const UTP = require('utp-native')
const once = require('events.once')
const { test, only } = require('tap')
const guts = require('..')

const promisifyApi = (o) => {
  const connect = promisify(o.connect)
  const lookupOne = promisify(o.lookupOne)
  const lookup = promisify(o.lookup)
  const bind = promisify(o.bind)
  const close = promisify(o.close)
  return {
    __proto__: o,
    connect,
    lookupOne,
    lookup,
    bind,
    close
  }
}

const when = () => {
  var done
  const fn = () => done()
  fn.done = promisify((cb) => { done = cb })
  return fn
}

function validSocket (s) {
  if (!s) return false
  return (s instanceof net.Socket) || (s._utp && s._utp instanceof UTP)
}

test('network bound – bind option', async ({ pass, plan }) => {
  plan(1)
  const network = promisifyApi(guts({
    bind () { pass('method called') }
  }))
  await network.bind()
  await network.close()
})
test('network closed – close option', async ({ pass, plan }) => {
  plan(1)
  const network = promisifyApi(guts({
    close () { pass('method called') }
  }))
  await network.bind()
  await network.close()
})

test('connect two peers with address details', async ({ is, pass }) => {
  const network = promisifyApi(guts())
  await network.bind()
  const client = promisifyApi(guts())
  const { port } = network.address()
  const host = '127.0.0.1'
  const socket = await client.connect({ port, host })
  is(validSocket(socket), true, 'got client socket')
  await client.close()
  pass('client closed')
  await network.close()
  pass('network closed')
})

test('connect two peers via lookup', async ({ is, pass }) => {
  const network = promisifyApi(guts())
  await network.bind()
  const client = promisifyApi(guts())
  const topic = randomBytes(32)
  await once(network.announce(topic), 'update')
  await client.bind()
  const peer = await client.lookupOne(topic)
  const socket = await client.connect(peer)
  is(validSocket(socket), true, 'got client socket')
  await client.close()
  pass('client closed')
  await network.close()
  pass('network closed')
})

test('socket recieved – socket option – (address details based connection)', async ({ is }) => {
  const until = when()
  const network = promisifyApi(guts({
    async socket (sock) {
      is(validSocket(sock), true)
      await network.close()
      await client.close()
      until()
    }
  }))
  await network.bind()
  const client = promisifyApi(guts())
  const { port } = network.address()
  const host = '127.0.0.1'
  await client.connect({ port, host })
  await until.done()
})

test('socket recieved – socket option – (lookup based connection)', async ({ is }) => {
  const until = when()
  const network = promisifyApi(guts({
    async socket (sock) {
      is(validSocket(sock), true)
      await network.close()
      await client.close()
      until()
    }
  }))
  await network.bind()
  const client = promisifyApi(guts())
  const topic = randomBytes(32)
  const sub = network.announce(topic)
  await once(sub, 'update')
  await client.bind()
  const peer = await client.lookupOne(topic)
  await client.connect(peer)
  await until.done()
})

test('send data to network peer', async ({ is }) => {
  const until = when()
  const network = promisifyApi(guts({
    async socket (sock) {
      const [ data ] = await once(sock, 'data')
      is(data.toString(), 'test')
      await network.close()
      await client.close()
      until()
    }
  }))
  await network.bind()
  const client = promisifyApi(guts())
  const topic = randomBytes(32)
  const sub = network.announce(topic)
  await once(sub, 'update')
  await client.bind()
  const peer = await client.lookupOne(topic)
  const socket = await client.connect(peer)
  socket.write('test')
  await until.done()
})

test('send data to client peer', async ({ is }) => {
  const until = when()
  const network = promisifyApi(guts({
    async socket (socket) {
      socket.write('test')
      await network.close()
      await client.close()
      until()
    }
  }))
  await network.bind()
  const client = promisifyApi(guts())
  const topic = randomBytes(32)
  const sub = network.announce(topic)
  await once(sub, 'update')
  await client.bind()
  const peer = await client.lookupOne(topic)
  const socket = await client.connect(peer)
  const [ data ] = await once(socket, 'data')
  is(data.toString(), 'test')
  await until.done()
})

test('send data bidirectionally between network and client', async ({ is }) => {
  const until = when()
  const network = promisifyApi(guts({
    async socket (socket) {
      const [ data ] = await once(socket, 'data')
      is(data.toString(), 'from client')
      socket.write('from network')
      await network.close()
      await client.close()
      until()
    }
  }))
  await network.bind()
  const client = promisifyApi(guts())
  const topic = randomBytes(32)
  const sub = network.announce(topic)
  await once(sub, 'update')
  await client.bind()
  const peer = await client.lookupOne(topic)
  const socket = await client.connect(peer)
  socket.write('from client')
  const [ data ] = await once(socket, 'data')
  is(data.toString(), 'from network')
  await until.done()
})

test('referrer node (peer info from DHT)', async ({ is }) => {
  const network = promisifyApi(guts())
  await network.bind()
  const client = promisifyApi(guts())
  const referrer = dgram.createSocket('udp4')
  await promisify(referrer.bind.bind(referrer))()
  const connecting = client.connect({ 
    host: '127.0.0.1',
    port: network.address().port,
    referrer: { 
      host: '127.0.0.1',
      port: referrer.address().port
    }
  })
  const [ msg ] = await once(referrer, 'message')
  is(/_holepunch/.test(msg), true, 'triggers a holepunch command to referrer node')
  // not strictly necessary, since we would never get msg
  // if client was connected, however for explicitness sake: 
  await connecting
  await network.close()
  await client.close()
  await promisify(referrer.close.bind(referrer))()
})