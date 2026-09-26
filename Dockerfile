FROM node:22-bookworm-slim AS web-build
WORKDIR /src
COPY . .
RUN npm install --global npm@12.1.0
RUN npm ci
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS server-build
WORKDIR /src
COPY . .
COPY --from=web-build /src/apps/web/dist ./src/server/RoomCraft.Host/wwwroot
RUN dotnet publish src/server/RoomCraft.Host/RoomCraft.Host.csproj \
    --configuration Release \
    --runtime linux-x64 \
    --self-contained true \
    --output /out

FROM postgres:18.6-bookworm AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=server-build /out ./
COPY docker/entrypoint.sh /usr/local/bin/roomcraft-entrypoint
RUN chmod 0755 /usr/local/bin/roomcraft-entrypoint

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://0.0.0.0:8080 \
    ConnectionStrings__RoomCraft="Host=127.0.0.1;Port=5432;Database=roomcraft;Username=roomcraft" \
    Assets__StoragePath=/data/assets \
    PGDATA=/data/postgres

EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/roomcraft-entrypoint"]
