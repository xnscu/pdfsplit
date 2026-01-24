FROM ubuntu:22.04

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VER=20
ENV PG_VER=15.5

# 更新包管理器并安装基础工具和 locale
RUN apt-get update && apt-get install -y \
    build-essential \
    wget \
    unzip \
    make \
    gcc \
    libpcre3-dev \
    libssl-dev \
    perl \
    curl \
    zlib1g \
    zlib1g-dev \
    ca-certificates \
    gnupg \
    git \
    libreadline-dev \
    sudo \
    locales

# 配置 en_US.UTF-8 locale，防止 perl locale 警告
RUN locale-gen en_US.UTF-8 && update-locale LANG=en_US.UTF-8
ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8

# 安装 Node.js
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VER}.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs

# 安装全局 npm 包
RUN npm install -g \
    yarn \
    dotenv-cli \
    corepack@0.20.0 \
    @anthropic-ai/claude-code \
    wrangler@latest \
    && corepack enable

WORKDIR /tmp

# 安装 PostgreSQL
RUN apt-get update \
    && apt-get install -y postgresql postgresql-contrib \
    && rm -rf /var/lib/apt/lists/*

# 配置 PostgreSQL
RUN service postgresql start \
    && su - postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\"" \
    && service postgresql stop


WORKDIR /workspace

# 暴露常用端口
EXPOSE 80 443 3000 5432 8080 5173 8000 8787

# 创建 claude 命令别名
RUN echo 'alias claude="IS_SANDBOX=1 DISABLE_TELEMETRY=1 claude --dangerously-skip-permissions"' >> /etc/bash.bashrc

# 设置默认命令
CMD ["/bin/bash"]
