import PB, {Namespace, ReflectionObject, Service, Type} from 'protobufjs'
import {sendUnaryData, ServerUnaryCall} from "grpc"

const visitedClient: string[] = []
const visitedServer: string[] = []

function generateServer(x: ReflectionObject, path: string) {
  if (x instanceof Namespace) {
    if (x.nested) {
      for (const name in x.nested) {
        generateServer(x.nested[name], `${path}.${name}`)
      }
    }
  }

  if (visitedServer.indexOf(x.fullName) >= 0) {
    return
  } else {
    visitedServer.push(x.fullName)
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

        if (!requestSerializers[m.responseType]) {
          requestSerializers[m.responseType] = `(t: ${intName(res)}) => <Buffer>${nspName(res)}.encode(t).finish()`
        }

        if (!responseDeserializers[m.requestType]) {
          responseDeserializers[m.requestType] = `(b: Buffer) => ${nspName(req)}.decode(<Uint8Array>b)`
        }

        if (!responseDeserializers[m.responseType]) {
          responseDeserializers[m.responseType] = `(b: Buffer) => ${nspName(res)}.decode(<Uint8Array>b)`
        }
      }
    }

    println(`export abstract class ${x.name}Server {`)
    println('')

    for (const name in requestSerializers) {
      println(`\tprivate serialize${name} = ${requestSerializers[name]}`)
    }

    for (const name in responseDeserializers) {
      println(`\tprivate deserialize${name} = ${responseDeserializers[name]}`)
    }

    println('')

    println('\tconstructor(server: grpc.Server) {')
    println('\t\tserver.addService({')

    for (const m of x.methodsArray) {
      // TODO: this guard goes away in the future
      if (!m.requestStream && !m.responseStream) {
        const {resolvedRequestType: req, resolvedResponseType: res} = m
        if (req && res) {
          println(`\t\t\t${m.name}: {`)
          println(`\t\t\t\tresponseStream: false, requestStream: false, path: '${rpcName(m.fullName)}',`)
          println(`\t\t\t\trequestSerialize: this.serialize${req.name},`)
          println(`\t\t\t\trequestDeserialize: this.deserialize${req.name},`)
          println(`\t\t\t\tresponseSerialize: this.serialize${res.name},`)
          println(`\t\t\t\tresponseDeserialize: this.deserialize${res.name}`)
          println(`\t\t\t},`)
        }
      }
    }
    println('\t\t}, {')

    for (const m of x.methodsArray) {
      if (!m.requestStream && !m.responseStream) {
        const {resolvedRequestType: req, resolvedResponseType: res} = m
        if (req && res) {
          println(`\t\t\t${m.name}: (call: ServerUnaryCall<${intName(req)}>, callback: sendUnaryData<${intName(res)}>) => this.${m.name}(call.request, call.metadata).then(r => callback(null, r), e => callback(e, null)),`)
        }
      }
    }

    println('\t\t})')
    println('\t}')

    println('')

    /* for each method */
    for (const m of x.methodsArray) {
      /* unary */
      if (!m.requestStream && !m.responseStream) {
        const {resolvedRequestType: req, resolvedResponseType: res} = m

        if (req && res) {
          println(`\tabstract ${m.name}(arg: ${intName(req)}, meta?: grpc.Metadata): Promise<${intName(res)}>;`)
        }
      } else if (m.responseStream && !m.requestStream) {
        println(`\t// TODO ${m.fullName} - server streaming`)
      } else if (m.requestStream && !m.responseStream) {
        println(`\t// TODO ${m.fullName} - client streaming`)
      } else {
        println(`\t// TODO ${m.fullName} - bidi streaming`)
      }
    }

    println('}')
  }
}

function generateClient(x: ReflectionObject, path: string) {
  if (x instanceof Namespace) {
    if (x.nested) {
      for (const name in x.nested) {
        generateClient(x.nested[name], `${path}.${name}`)
      }
    }
  }


  if (visitedClient.indexOf(x.fullName) >= 0) {
    return
  } else {
    visitedClient.push(x.fullName)
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

    println(`export class ${x.name}Client extends grpc.Client {`)
    println('')

    for (const name in requestSerializers) {
      println(`\tprivate serialize${name} = ${requestSerializers[name]}`)
    }

    for (const name in responseDeserializers) {
      println(`\tprivate deserialize${name} = ${responseDeserializers[name]}`)
    }

    println('')

    println('\tconstructor(endpoint: string, security?: grpc.ChannelCredentials) {')
    println('\t\tsuper(endpoint, security || grpc.credentials.createInsecure())')
    println('\t}')

    println('')

    /* for each method */
    for (const m of x.methodsArray) {
      /* unary */
      if (!m.requestStream && !m.responseStream) {
        const {resolvedRequestType: req, resolvedResponseType: res} = m

        if (req && res) {
          println(`\t${m.name}(arg: ${intName(req)}, meta?: grpc.Metadata): Promise<${intName(res)}> {`)
          println(`\t\treturn new Promise<${nspName(res)}>((resolve, reject) => {`)
          println(`\t\t\tthis.makeUnaryRequest('${rpcName(m.fullName)}', this.serialize${m.requestType}, this.deserialize${m.responseType}, arg, meta || null, null, (error, result) => error ? reject(error) : resolve(result))`)
          println(`\t\t})`)
          println(`\t}`)
        }
      } else if (m.responseStream && !m.requestStream) {
        println(`\t// TODO ${m.fullName} - server streaming`)
      } else if (m.requestStream && !m.responseStream) {
        println(`\t// TODO ${m.fullName} - client streaming`)
      } else {
        println(`\t// TODO ${m.fullName} - bidi streaming`)
      }
    }

    println('}')

    println('')

    println(`(<any>${x.name}Client.prototype).$method_definitions = {};`)
    println(`(<any>${x.name}Client.prototype).$method_names = {};`)

    println('')
  }
}

function collectNamespacesAndGlobals(nsp: string[], globals: string[], n: ReflectionObject) {
  function visit(n: ReflectionObject, path: string[]) {
    if (n instanceof Namespace && n.nested) {
      const key = path.join('.')
      if (path.length > 0 && nsp.indexOf(key) < 0) {
        nsp.push(key)
      }

      for (const name in n.nested) {
        visit(n.nested[name], [...path, name])
      }
    }

    if (n instanceof Service) {
      for (const m of n.methodsArray) {
        const {resolvedRequestType: req, resolvedResponseType: res} = m
        if (req && res) {
          if (req.parent == req.root && globals.indexOf(req.name) < 0) {
            globals.push(req.name)
            globals.push('I' + req.name)
          }

          if (res.parent == res.root && globals.indexOf(res.name) < 0) {
            globals.push(res.name)
            globals.push('I' + res.name)
          }
        }
      }
    }
  }

  visit(n, [])
}

const roots = process.argv.slice(2).map(file => PB.loadSync(file))
/* find all top level imports */
roots.forEach(r => r.resolveAll())

const namespaces: string[] = []
const globals: string[] = []
roots.forEach(r => collectNamespacesAndGlobals(namespaces, globals, r))


console.log('import grpc, {ServerUnaryCall, sendUnaryData} from \'grpc\'')
console.log(`import {${[...namespaces, ...globals].join(', ')}} from '../apis/proto'`)

roots.forEach(r => generateClient(r, ""))
roots.forEach(r => generateServer(r, ""))
