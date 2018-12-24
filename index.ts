import PB, {Namespace, Service, Type} from 'protobufjs'

console.log('import grpc from \'grpc\'\n' +
  'import {CommandQueued, files} from \'../api/proto\'')


const visited: string[] = []

function visit(x: PB.ReflectionObject, path: string) {
  if (x instanceof Namespace) {
    if (x.nested) {
      for (const name in x.nested) {
        visit(x.nested[name], `${path}.${name}`)
      }
    }
  }


  if (visited.indexOf(x.fullName) >= 0) {
    return
  } else {
    visited.push(x.fullName)
  }

  function nspName(x: Type) {
    return x.fullName.substr(1)
  }

  function intName(x: Type) {
    const rv = x.fullName
    return (rv.substr(0, rv.lastIndexOf('.') + 1) + 'I' + x.name).substr(1)
  }

  function rpcName(x: string) {
    return `/${x.substr(1, x.lastIndexOf('.') - 1)}/${x.substr(x.lastIndexOf('.') + 1)}`
  }

  const println = console.log
  if (x instanceof Service) {
    const requestSerializers: any = {}
    const responseDeserializers: any = {}

    for (const m of x.methodsArray) {
      const {resolvedRequestType: req, resolvedResponseType: res} = m

      if (req && res) {

        if (!requestSerializers[m.requestType]) {
          requestSerializers[m.requestType] = `(t: ${intName(req)}) => <Buffer>${nspName(req)}.encode(t).finish()`
        }

        if (!responseDeserializers[m.responseType]) {
          responseDeserializers[m.responseType] = `(b: Buffer) => ${nspName(res)}.decode(<Uint8Array>b)`
        }
      }
    }

    println(`export class ${x.name}Client {`)
    println('private client: grpc.Client')
    println('')

    for (const name in requestSerializers) {
      println(`\tprivate serialize${name} = ${requestSerializers[name]}`)
    }

    for (const name in responseDeserializers) {
      println(`\tprivate deserialize${name} = ${responseDeserializers[name]}`)
    }

    println('')

    println('\tconstructor(endpoint: string, security?: grpc.ChannelCredentials) {')
    println('\t\tthis.client = new grpc.Client(endpoint, security || grpc.credentials.createInsecure())')
    println('\t}')

    println('')

    /* for each method */
    for (const m of x.methodsArray) {
      /* unary */
      if (!m.requestStream && !m.responseStream) {
        const {resolvedRequestType: req, resolvedResponseType: res} = m

        if (req && res) {
          println(`\t${m.name}(arg: ${nspName(req)}, meta?: grpc.Metadata): Promise<${nspName(res)}> {`)
          println(`\t\treturn new Promise<${nspName(res)}>((resolve, reject) => {`)
          println(`\t\t\tthis.client.makeUnaryRequest('${rpcName(m.fullName)}', this.serialize${m.requestType}, this.deserialize${m.responseType}, arg, meta || null, null, (error, result) => error ? reject(error) : resolve(result))`)
          println(`\t\t})`)
          println(`\t}`)
        }
      }
    }

    println('}')
  }
}

const roots = process.argv.slice(2).map(file => PB.loadSync(file))
roots.forEach(r => r.resolveAll())
roots.forEach(r => visit(r, ""))
