FROM node:20-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:20-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build


FROM alpine:latest
ARG PB_VERSION=0.28.2

RUN apk add --no-cache \
    unzip \
    ca-certificates

# download and unzip PocketBase
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/

# copy built frontend files
COPY --from=build-env /app/build/client /pb/pb_public

# server-side JS hooks (Google Chat OAuth routes + turn notifications)
COPY pb_hooks /pb/pb_hooks

EXPOSE 8080

# Google Chat integration is optional — the feature stays hidden in the UI
# unless GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are provided at
# runtime. APP_BASE_URL is used to build the OAuth redirect and player links.
ENV GOOGLE_OAUTH_CLIENT_ID="" \
    GOOGLE_OAUTH_CLIENT_SECRET="" \
    APP_BASE_URL=""

# start PocketBase
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8080"]