import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";
import { databaseConfig } from "./env";

let driver: Driver | undefined;

export function getDriver() {
  if (!driver) {
    const config = databaseConfig();
    driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
  }
  return driver;
}

export async function readQuery<T>(work: (tx: ManagedTransaction) => Promise<T>) {
  const config = databaseConfig();
  const session = getDriver().session({ database: config.database, defaultAccessMode: neo4j.session.READ });
  try {
    return await session.executeRead(work);
  } finally {
    await session.close();
  }
}

export async function writeQuery<T>(work: (tx: ManagedTransaction) => Promise<T>) {
  const config = databaseConfig();
  const session = getDriver().session({ database: config.database, defaultAccessMode: neo4j.session.WRITE });
  try {
    return await session.executeWrite(work);
  } finally {
    await session.close();
  }
}
