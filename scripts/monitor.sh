#!/bin/bash

###############################################################################
# Midnight Node 监控脚本（增强版）
# 功能：
# - 节点状态检查（区块高度、对等节点、同步状态）
# - 系统资源监控（CPU、内存、磁盘）
# - Telegram 告警
# - 邮件告警
# - 日志记录
#
# 使用：
# 1. 配置 Telegram Bot Token 和 Chat ID
# 2. chmod +x monitor.sh
# 3. ./monitor.sh
# 4. 设置 cron 定时任务（每 5 分钟）
###############################################################################

# ==================== 配置区域 ====================

# 节点配置
NODE_URL="http://localhost:8545"
NODE_NAME="my-midnight-node"

# Telegram 配置（可选）
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN"
TELEGRAM_CHAT_ID="YOUR_CHAT_ID"

# 邮件配置（可选）
EMAIL_ENABLED=false
EMAIL_TO="your-email@example.com"

# 告警阈值
PEER_COUNT_MIN=5
DISK_USAGE_MAX=85
MEM_USAGE_MAX=90
CPU_USAGE_MAX=95

# 日志配置
LOG_FILE="/var/log/midnight-monitor.log"
ALERT_LOG="/var/log/midnight-alerts.log"

# ==================== 函数定义 ====================

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Telegram 发送函数
send_telegram() {
    if [ "$TELEGRAM_ENABLED" = true ]; then
        curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
            -d "chat_id=$TELEGRAM_CHAT_ID" \
            -d "text=$1" \
            -d "parse_mode=Markdown" >> /dev/null
    fi
}

# 邮件发送函数
send_email() {
    if [ "$EMAIL_ENABLED" = true ]; then
        echo "$1" | mail -s "🚨 Midnight Node 告警 - $NODE_NAME" "$EMAIL_TO"
    fi
}

# 发送告警
send_alert() {
    local message="$1"
    local severity="$2"  # WARNING or CRITICAL
    
    log "ALERT [$severity]: $message"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$severity] $message" >> "$ALERT_LOG"
    
    local emoji="⚠️"
    if [ "$severity" = "CRITICAL" ]; then
        emoji="🚨"
    fi
    
    local alert_text="$emoji *Midnight Node 告警* - $NODE_NAME\n\n$message\n\n时间：$(date '+%Y-%m-%d %H:%M:%S')"
    
    send_telegram "$alert_text"
    send_email "$message"
}

# ==================== 主程序 ====================

log "========== 开始健康检查 =========="

# 获取节点状态
BLOCK_HEIGHT=$(curl -s -X POST "$NODE_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' 2>/dev/null | \
    jq -r '.result // "error"' | \
    xargs printf "%d\n" 2>/dev/null)

if [ "$BLOCK_HEIGHT" = "0" ] || [ "$BLOCK_HEIGHT" = "error" ]; then
    send_alert "❌ 节点无响应！无法获取区块高度。" "CRITICAL"
    exit 1
fi

PEER_COUNT=$(curl -s -X POST "$NODE_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}' 2>/dev/null | \
    jq -r '.result // "0"' | \
    xargs printf "%d\n" 2>/dev/null)

SYNC_STATUS=$(curl -s -X POST "$NODE_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' 2>/dev/null | \
    jq -r '.result')

# 获取系统资源使用
CPU_USAGE=$(top -bn1 2>/dev/null | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
if [ -z "$CPU_USAGE" ]; then
    CPU_USAGE=$(vmstat 1 2 2>/dev/null | tail -1 | awk '{print 100 - $15}')
fi

MEM_USAGE=$(free 2>/dev/null | grep Mem | awk '{printf("%.1f", $3/$2 * 100.0)}')
DISK_USAGE=$(df -h / 2>/dev/null | tail -1 | awk '{print $5}' | cut -d'%' -f1)

# 打印状态
log "区块高度：$BLOCK_HEIGHT"
log "对等节点：$PEER_COUNT"
log "同步状态：$SYNC_STATUS"
log "CPU 使用率：${CPU_USAGE}%"
log "内存使用率：${MEM_USAGE}%"
log "磁盘使用率：${DISK_USAGE}%"

# 告警检查
ALERT_COUNT=0
WARNING_COUNT=0

# 检查对等节点数量
if [ "$PEER_COUNT" -lt "$PEER_COUNT_MIN" ] 2>/dev/null; then
    send_alert "⚠️ 对等节点过少：当前 $PEER_COUNT 个（最低要求：$PEER_COUNT_MIN 个）" "WARNING"
    ((WARNING_COUNT++))
fi

# 检查磁盘空间
if [ "${DISK_USAGE%.*}" -gt "$DISK_USAGE_MAX" ] 2>/dev/null; then
    send_alert "🚨 磁盘空间不足：当前 ${DISK_USAGE}%（阈值：${DISK_USAGE_MAX}%）" "CRITICAL"
    ((ALERT_COUNT++))
fi

# 检查内存使用
if [ "${MEM_USAGE%.*}" -gt "$MEM_USAGE_MAX" ] 2>/dev/null; then
    send_alert "🚨 内存使用率过高：当前 ${MEM_USAGE}%（阈值：${MEM_USAGE_MAX}%）" "CRITICAL"
    ((ALERT_COUNT++))
fi

# 检查 CPU 使用
if [ "${CPU_USAGE%.*}" -gt "$CPU_USAGE_MAX" ] 2>/dev/null; then
    send_alert "⚠️ CPU 使用率过高：当前 ${CPU_USAGE}%（阈值：${CPU_USAGE_MAX}%）" "WARNING"
    ((WARNING_COUNT++))
fi

# 检查同步状态（如果正在同步且长时间未进展，可能有问题）
if [ "$SYNC_STATUS" != "false" ] && [ "$SYNC_STATUS" != "null" ]; then
    CURRENT_BLOCK=$(echo "$SYNC_STATUS" | jq -r '.currentBlock // "unknown"' 2>/dev/null)
    HIGHEST_BLOCK=$(echo "$SYNC_STATUS" | jq -r '.highestBlock // "unknown"' 2>/dev/null)
    log "同步进度：$CURRENT_BLOCK / $HIGHEST_BLOCK"
fi

# 总结
log "========== 检查完成 =========="
log "告警数量：$ALERT_COUNT (CRITICAL), $WARNING_COUNT (WARNING)"

# 如果有严重告警，退出码设为 1
if [ "$ALERT_COUNT" -gt 0 ]; then
    exit 1
fi

exit 0
