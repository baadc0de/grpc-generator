import PB, {Namespace, Service} from 'protobufjs'

const rv = PB.loadSync(process.argv[2])

function visit(x: PB.ReflectionObject, path: string) {
  if (x instanceof Namespace) {
    if (x.nested) {
      for (const name in x.nested) {
        visit(x.nested[name], `${path}.${name}`)
      }
    }
  }

  const println = console.log
  if (x instanceof Service) {
    const requestSerializers: any = {}
    const responseDeserializers: any = {}

    for (const m of x.methodsArray) {

      if (!requestSerializers[m.requestType]) {
        requestSerializers[m.requestType] = `(t: I${m.requestType}) => ${m.requestType}.encode(t).finish()`
      }

      if (!responseDeserializers[m.responseType]) {
        responseDeserializers[m.responseType] = `(b: Buffer) => ${m.requestType}.decode(<Uint8Array>b)`
      }
    }

    println(`export class ${x.name}Client {`)
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
      if (!m.requestStream && !m.responseStream) {
        /* unary */
        println(`\t${m.name}(arg: ${m.requestType}, meta?: grpc.Metadata): Promise<${m.responseType}> {`)
        println(`\t\treturn new Promise<${m.responseType}>((request, response) => {`)
        println(`\t\t\tthis.client.makeUnaryRequest('${m.fullName.replace('.', '/')}', this.serialize${m.requestType}, this.deserialize${m.responseType}, arg, meta, null, (error, result) => error ? reject(error) : resolve(result))`)
        println(`\t\t})`)
        println(`\t}`)
      }
    }

    println('}')
  }
}

visit(rv, "")
