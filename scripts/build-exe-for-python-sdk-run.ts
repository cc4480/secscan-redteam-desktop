/**
 * Entry point for the Python SDK executable builder.
 */

import { BuildCli } from './build-exe-for-python-sdk-cli.ts'
import { SingleExeBuild } from './build-exe-for-python-sdk-pipeline.ts'

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2))
  const pipeline = new SingleExeBuild(cli)
  console.log(`build-exe-for-python-sdk: targets: ${cli.targets.map(target => target.spec).join(', ')}`)
  console.log(`build-exe-for-python-sdk: staging: ${pipeline.staging}`)
  await pipeline.verifyClosure()
  await pipeline.build()
  await pipeline.deployStaging()
  await pipeline.injectPkgConfig()
  const products: string[] = []
  for (const target of cli.targets) products.push(...await pipeline.pack(target))
  pipeline.printProducts(products)
  await pipeline.syncToPythonRuntime(products)
}

await main()
