import PB, {Namespace, ReflectionObject, roots, Service, Type} from 'protobufjs'
import {sendUnaryData, ServerUnaryCall} from "grpc"
import program, {Command} from 'commander'
import * as fs from "fs"
import {Writable} from "stream"


const visitedClient: string[] = []
const visitedServer: string[] = []
const visitedMeta: string[] = []

function generateMeta(out: Writable, x: ReflectionObject, path: string) {
  if (x instanceof Namespace) {
    if (x.nested) {
      for (const name in x.nested) {
        generateMeta(out, x.nested[name], `${path}.${name}`)
      }
    }
  }

  if (visitedMeta.indexOf(x.fullName) >= 0) {
    return
  } else {
    visitedMeta.push(x.fullName)
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

  const println = (str: string) => out.write(str + '\n')

  if (x instanceof Service) {
    println(`\t{service: '${x.name}', methods: [`)
    for (const m of x.methodsArray) {
      const {resolvedRequestType: req, resolvedResponseType: res} = m
      if (req && res) {
        println(`\t{name: '${rpcName(m.fullName)}', reqType: ${nspName(req)}, resType: ${nspName(res)}, reqStream: ${!!m.requestStream}, resStream: ${!!m.responseStream}},`)
      }
    }
    println(`\t]},`)
  }
}

function generateServer(out: Writable, x: ReflectionObject, path: string) {
  if (x instanceof Namespace) {
    if (x.nested) {
      for (const name in x.nested) {
        generateServer(out, x.nested[name], `${path}.${name}`)
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

  const println = (str: string) => out.write(str + '\n')
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

    println('\tattachToServer(server: grpc.Server) {')
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
      const {resolvedRequestType: req, resolvedResponseType: res} = m
      if (req && res) {
        if (!m.requestStream && !m.responseStream) {
          println(`\tabstract ${m.name}(arg: ${intName(req)}, meta?: grpc.Metadata): Promise<${intName(res)}>;`)
        } else if (m.responseStream && !m.requestStream) {
          println(`\tabstract ${m.name}(arg: ${intName(req)}, meta?: grpc.Metadata): Observable<${intName(res)}>;`)
        } else if (m.requestStream && !m.responseStream) {
          println(`\tabstract ${m.name}(arg: Observable<${intName(req)}>, meta?: grpc.Metadata): Promise<${intName(res)}>;`)
        } else {
          println(`\tabstract ${m.name}(arg: Observable<${intName(req)}>, meta?: grpc.Metadata): Observable<${intName(res)}>;`)
        }
      }
    }

    println('}')
  }
}

function generateClient(out: Writable, x: ReflectionObject, path: string) {
  if (x instanceof Namespace) {
    if (x.nested) {
      for (const name in x.nested) {
        generateClient(out, x.nested[name], `${path}.${name}`)
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

  const println = (str: string) => out.write(str + '\n')

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
      const {resolvedRequestType: req, resolvedResponseType: res} = m
      if (req && res) {
        if (!m.requestStream && !m.responseStream) {
          println(`\t${m.name}(arg: ${intName(req)}, meta?: grpc.Metadata): Promise<${intName(res)}> {`)
          println(`\t\treturn new Promise<${nspName(res)}>((resolve, reject) => {`)
          println(`\t\t\tthis.makeUnaryRequest('${rpcName(m.fullName)}', this.serialize${m.requestType}, this.deserialize${m.responseType}, arg, meta || null, null, (error, result) => error ? reject(error) : resolve(result))`)
          println(`\t\t})`)
          println(`\t}`)
        } else if (m.responseStream && !m.requestStream) {
          println(`\t${m.name}(arg: ${intName(req)}, meta?: grpc.Metadata): Observable<${intName(res)}> {`)
          println(`\t\tconst stream = this.makeServerStreamRequest('${rpcName(m.fullName)}', this.serialize${m.requestType}, this.deserialize${m.responseType}, arg, meta || null, null)`)
          println(`\t\tconst rv = new AsyncSubject<${intName(res)}>()`)
          println(`\t\tstream.on('data', item => rv.next(item))`)
          println(`\t\tstream.on('error', item => rv.error(item))`)
          println(`\t\tstream.on('end', () => rv.complete())`)
          println(`\t\treturn rv`)
          println(`\t}`)

        } else if (m.requestStream && !m.responseStream) {
          println(`\t${m.name}(arg: Observable<${intName(req)}>, meta?: grpc.Metadata): Promise<${intName(res)}> {`)
          println(`\t\treturn new Promise<${nspName(res)}>((resolve, reject) => {`)
          println(`\t\t\tconst stream = this.makeClientStreamRequest('${rpcName(m.fullName)}', this.serialize${m.requestType}, this.deserialize${m.responseType}, meta || null, null, (error, result) => error ? reject(error) : resolve(result))`)
          println(`\t\t\targ.subscribe(item => stream.write(item), (err) => stream.destroy(err), () => stream.end())`)
          println(`\t\t})`)
          println(`\t}`)
        } else {
          println(`\t${m.name}(arg: Observable<${intName(req)}>, meta?: grpc.Metadata): Observable<${intName(res)}> {`)
          println(`\t\tconst stream = this.makeBidiStreamRequest('${rpcName(m.fullName)}', this.serialize${m.requestType}, this.deserialize${m.responseType}, meta || null, null)`)
          println(`\t\tconst rv = new AsyncSubject<${intName(res)}>()`)
          println(`\t\tstream.on('data', item => rv.next(item))`)
          println(`\t\tstream.on('error', item => rv.error(item))`)
          println(`\t\tstream.on('end', () => rv.complete())`)
          println(`\t\targ.subscribe(item => stream.write(item), (err) => stream.destroy(err), () => stream.end())`)
          println(`\t\treturn rv`)
          println(`\t}`)
        }
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

program.version("1.0.0")
  .option('-i, --include <path>', 'include path', './proto')
  .option('-o, --output <path>', 'output path', 'node.ts')
  .option('-m, --meta <path>', 'meta output path', 'meta.ts')
  .action(function (...args) {
    const {include, output, meta} = args.pop()
    let out = fs.createWriteStream(output)

    const roots = args.map(file => PB.loadSync(file))
    /* find all top level imports */
    roots.forEach(r => r.resolveAll())

    const namespaces: string[] = []
    const globals: string[] = []
    roots.forEach(r => collectNamespacesAndGlobals(namespaces, globals, r))


    out.write('import grpc, {ServerUnaryCall, sendUnaryData} from \'grpc\'\n')
    out.write('import {AsyncSubject, Observable} from \'rxjs\'\n')
    out.write(`import {${[...namespaces, ...globals].join(', ')}} from '${include}'\n\n`)

    roots.forEach(r => generateClient(out, r, ""))
    roots.forEach(r => generateServer(out, r, ""))

    out.end()
    out = fs.createWriteStream(meta)

    out.write(`import {${[...namespaces, ...globals.filter(n => !n.startsWith('I'))].join(', ')}} from '${include}'\n\n`)

    out.write(`export default [\n`)
    roots.forEach(r => generateMeta(out, r, ""))
    out.write(`]\n`)

    out.end(() => process.exit(0))
  })

program.parse(process.argv)
