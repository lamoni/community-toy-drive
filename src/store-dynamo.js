import { DynamoDBClient, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

/** tableNames: { nominations: "...", signups: "...", summaries: "..." } */
export function createDynamoStore(tableNames) {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });

  const name = (table) => {
    const n = tableNames[table];
    if (!n) throw new Error(`Unknown table ${table}`);
    return n;
  };

  async function scan(table) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await doc.send(new ScanCommand({ TableName: name(table), ExclusiveStartKey }));
      items.push(...page.Items);
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  return {
    async list(table) {
      return scan(table);
    },
    async get(table, id) {
      const res = await doc.send(new GetCommand({ TableName: name(table), Key: { id }, ConsistentRead: true }));
      return res.Item || null;
    },
    async insert(table, record) {
      await doc.send(
        new PutCommand({ TableName: name(table), Item: record, ConditionExpression: "attribute_not_exists(id)" })
      );
    },
    async update(table, id, changes) {
      const keys = Object.keys(changes);
      try {
        await doc.send(
          new UpdateCommand({
            TableName: name(table),
            Key: { id },
            UpdateExpression: "SET " + keys.map((k, i) => `#k${i} = :v${i}`).join(", "),
            ExpressionAttributeNames: Object.fromEntries(keys.map((k, i) => [`#k${i}`, k])),
            ExpressionAttributeValues: Object.fromEntries(keys.map((k, i) => [`:v${i}`, changes[k]])),
            ConditionExpression: "attribute_exists(id)",
          })
        );
        return true;
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) return false;
        throw err;
      }
    },
    async remove(table, id) {
      const res = await doc.send(new DeleteCommand({ TableName: name(table), Key: { id }, ReturnValues: "ALL_OLD" }));
      return Boolean(res.Attributes);
    },
    async listSummaries() {
      return scan("summaries");
    },
    async putSummary(record) {
      await doc.send(new PutCommand({ TableName: name("summaries"), Item: record }));
    },
    async clearLists() {
      const deleted = {};
      for (const table of ["nominations", "signups"]) {
        const items = await scan(table);
        let queue = items.map((item) => ({ DeleteRequest: { Key: { id: item.id } } }));
        let guard = 0;
        while (queue.length) {
          if (++guard > 40) throw new Error(`Could not finish deleting ${table}`);
          const batch = queue.splice(0, 25);
          const res = await doc.send(new BatchWriteCommand({ RequestItems: { [name(table)]: batch } }));
          const leftover = res.UnprocessedItems?.[name(table)] || [];
          if (leftover.length) queue = leftover.concat(queue);
        }
        deleted[table] = items.length;
      }
      return deleted;
    },
  };
}
