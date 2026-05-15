import { INDEXER_HTTP_URL, INDEXER_WS_URL } from "../config";
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  split,
} from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { createClient } from "graphql-ws";
import { getMainDefinition } from "@apollo/client/utilities";

const httpLink = new HttpLink({ uri: INDEXER_HTTP_URL });

const wsLink = new GraphQLWsLink(
  createClient({
    url: INDEXER_WS_URL,
    connectionParams: () => ({}),
    shouldRetry: () => true,
    retryAttempts: 10,
    retryWait: (retries) =>
      new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000 * 2 ** retries, 30000))
      ),
  })
);

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === "OperationDefinition" &&
      definition.operation === "subscription"
    );
  },
  wsLink,
  httpLink
);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});
