import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Progress,
  Row,
  Select,
  Slider,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import {
  AimOutlined,
  ApiOutlined,
  AppstoreOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  DashboardOutlined,
  FieldTimeOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MobileOutlined,
  SelectOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateFilled,
  SaveOutlined,
  SettingOutlined,
  ThunderboltFilled,
  ThunderboltOutlined,
  UnlockOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import type {
  AgentSettings,
  ContextState,
  Decision,
  RobotStatus,
} from "../../../shared/types";

const { Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

type Page = "dashboard" | "logs" | "settings";

const decisionMeta: Record<
  Decision,
  { color: string; soft: string; label: string; icon: React.ReactNode }
> = {
  LOCK: {
    color: "#fb7185",
    soft: "rgba(251, 113, 133, .15)",
    label: "Secured",
    icon: <LockOutlined />,
  },
  UNLOCK: {
    color: "#2dd4bf",
    soft: "rgba(45, 212, 191, .15)",
    label: "Available",
    icon: <UnlockOutlined />,
  },
  WAIT: {
    color: "#38bdf8",
    soft: "rgba(56, 189, 248, .15)",
    label: "Monitoring",
    icon: <AimOutlined />,
  },
};

function signalLabel(rssi?: number): string {
  if (rssi === undefined) return "No signal";
  if (rssi >= -60) return "Excellent";
  if (rssi >= -72) return "Good";
  if (rssi >= -82) return "Weak";
  return "Very weak";
}

function decisionTag(decision?: Decision) {
  const value = decision ?? "WAIT";
  const meta = decisionMeta[value];
  return (
    <Tag
      bordered={false}
      icon={meta.icon}
      style={{
        color: meta.color,
        background: meta.soft,
        borderRadius: 999,
        paddingInline: 10,
      }}
    >
      {value}
    </Tag>
  );
}

export default function AirLockApp() {
  const { message, modal } = App.useApp();
  const [page, setPage] = useState<Page>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [context, setContext] = useState<ContextState | null>(null);
  const [robot, setRobot] = useState<RobotStatus | null>(null);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [logs, setLogs] = useState<ContextState[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [decisionFilter, setDecisionFilter] = useState<string>();
  const [dateFilter, setDateFilter] = useState("");
  const [actionLoading, setActionLoading] = useState<"lock" | "unlock" | null>(
    null
  );
  const [form] = Form.useForm<AgentSettings>();

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      setLogs(await window.airlock.getHistory(500));
    } catch {
      message.error("Could not load sensor history");
    } finally {
      setLogsLoading(false);
    }
  }, [message]);

  useEffect(() => {
    Promise.all([
      window.airlock.getContext(),
      window.airlock.getRobotStatus(),
      window.airlock.getSettings(),
    ])
      .then(([nextContext, nextRobot, nextSettings]) => {
        setContext(nextContext);
        setRobot(nextRobot);
        setSettings(nextSettings);
        if (nextSettings) form.setFieldsValue(nextSettings);
      })
      .catch(() => message.error("AirLock services are not responding"));

    const offContext = window.airlock.onContext(setContext);
    const offRobot = window.airlock.onRobotStatus(setRobot);
    const offLock = window.airlock.onLockEvent((event) => {
      message.success(
        event.action === "LOCK"
          ? "Workstation secured"
          : "Security state reset"
      );
    });

    return () => {
      offContext();
      offRobot();
      offLock();
    };
  }, [form, message]);

  useEffect(() => {
    if (page === "logs") void loadLogs();
  }, [page, loadLogs]);

  const runAction = async (action: "lock" | "unlock") => {
    setActionLoading(action);
    try {
      if (action === "lock") await window.airlock.manualLock();
      else await window.airlock.manualUnlock();
    } catch {
      message.error(`Unable to ${action} the workstation`);
    } finally {
      setActionLoading(null);
    }
  };

  const confirmLock = () => {
    modal.confirm({
      title: "Lock this workstation?",
      content:
        "AirLock will secure Windows and send the GUARD command to the robot.",
      icon: <LockOutlined style={{ color: "#fb7185" }} />,
      okText: "Lock now",
      okButtonProps: { danger: true },
      onOk: () => runAction("lock"),
    });
  };

  const saveSettings = async (values: AgentSettings) => {
    try {
      const updated = await window.airlock.updateSettings(values);
      setSettings(updated);
      form.setFieldsValue(updated);
      message.success("Settings saved");
    } catch {
      message.error("Could not save settings");
    }
  };

  const filteredLogs = useMemo(
    () =>
      logs.filter((row) => {
        if (decisionFilter && row.decision !== decisionFilter) return false;
        if (dateFilter) {
          const date = new Date(row.timestamp * 1000)
            .toISOString()
            .slice(0, 10);
          if (date !== dateFilter) return false;
        }
        return true;
      }),
    [dateFilter, decisionFilter, logs]
  );

  const columns: TableProps<ContextState>["columns"] = [
    {
      title: "Timestamp",
      dataIndex: "timestamp",
      width: 180,
      render: (value: number) => new Date(value * 1000).toLocaleString(),
    },
    {
      title: "Decision",
      dataIndex: "decision",
      width: 115,
      render: (value: Decision | undefined) => decisionTag(value),
    },
    {
      title: "Idle",
      dataIndex: "idleTime",
      width: 90,
      render: (value: number) => `${value}s`,
    },
    {
      title: "RSSI",
      dataIndex: "rssi",
      width: 95,
      render: (value: number) => `${value} dBm`,
    },
    {
      title: "Activity",
      width: 130,
      render: (_, row) => (
        <Space size={6}>
          <Badge
            status={row.keyboardActive ? "processing" : "default"}
            text="Keys"
          />
          <Badge
            status={row.mouseActive ? "processing" : "default"}
            text="Mouse"
          />
        </Space>
      ),
    },
    {
      title: "Phone",
      width: 120,
      render: (_, row) => (
        <Space>
          <MobileOutlined />
          {row.battery}%
        </Space>
      ),
    },
    {
      title: "Confidence",
      dataIndex: "confidence",
      width: 145,
      render: (value?: number) => (
        <Progress
          percent={value ?? 0}
          size="small"
          showInfo={value !== undefined}
          strokeColor="#38bdf8"
        />
      ),
    },
    {
      title: "Reason",
      dataIndex: "reason",
      ellipsis: true,
      render: (value?: string) => (
        <Tooltip title={value}>
          <Text type="secondary">{value || "—"}</Text>
        </Tooltip>
      ),
    },
  ];

  return (
    <Layout className="app-shell">
      <Sider
        width={244}
        collapsedWidth={84}
        collapsed={collapsed}
        className="app-sider"
        trigger={null}
      >
        <div className="brand">
          <div className="brand-mark">
            <SafetyCertificateFilled />
          </div>
          {!collapsed && (
            <div className="brand-copy">
              <strong>AirLock</strong>
              <span>Desktop security</span>
            </div>
          )}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          onClick={({ key }) => setPage(key as Page)}
          items={[
            {
              key: "dashboard",
              icon: <DashboardOutlined />,
              label: "Overview",
            },
            {
              key: "logs",
              icon: <AppstoreOutlined />,
              label: "Activity logs",
            },
            {
              key: "settings",
              icon: <SettingOutlined />,
              label: "Settings",
            },
          ]}
        />

        <div className="sider-footer">
          {!collapsed && (
            <Card size="small" className="service-card" bordered={false}>
              <Space direction="vertical" size={10}>
                <Badge
                  status="processing"
                  text={<Text className="service-text">Agent running</Text>}
                />
                <Badge
                  status={robot ? "success" : "default"}
                  text={
                    <Text className="service-text">
                      Robot {robot ? "linked" : "waiting"}
                    </Text>
                  }
                />
                <Badge
                  status={settings?.useAiEngine ? "success" : "warning"}
                  text={
                    <Text className="service-text">
                      AI {settings?.useAiEngine ? "enabled" : "local mode"}
                    </Text>
                  }
                />
              </Space>
            </Card>
          )}
          <Button
            type="text"
            block
            className="collapse-button"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
          >
            {!collapsed && "Collapse"}
          </Button>
        </div>
      </Sider>

      <Content className="app-content">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />
        {page === "dashboard" && (
          <Dashboard
            context={context}
            robot={robot}
            actionLoading={actionLoading}
            onLock={confirmLock}
            onUnlock={() => void runAction("unlock")}
          />
        )}
        {page === "logs" && (
          <section className="page page-enter">
            <PageHeader
              eyebrow="Telemetry archive"
              title="Activity logs"
              description="Review every context sample and security decision made by AirLock."
              action={
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => void loadLogs()}
                  loading={logsLoading}
                >
                  Refresh
                </Button>
              }
            />
            <Card className="glass-card table-card" bordered={false}>
              <div className="table-toolbar">
                <Space wrap>
                  <DatePicker
                    placeholder="Filter by date"
                    onChange={(_, value) => setDateFilter(value as string)}
                  />
                  <Select
                    allowClear
                    placeholder="All decisions"
                    style={{ width: 165 }}
                    onChange={setDecisionFilter}
                    options={["LOCK", "UNLOCK", "WAIT"].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Space>
                <Text type="secondary">
                  {filteredLogs.length} of {logs.length} records
                </Text>
              </div>
              <Table
                rowKey={(row) => `${row.timestamp}-${row.idleTime}`}
                columns={columns}
                dataSource={filteredLogs}
                loading={logsLoading}
                pagination={{ pageSize: 12, showSizeChanger: false }}
                scroll={{ x: 1100 }}
                locale={{
                  emptyText: (
                    <Empty description="No telemetry matches these filters" />
                  ),
                }}
              />
            </Card>
          </section>
        )}
        {page === "settings" && (
          <section className="page page-enter">
            <PageHeader
              eyebrow="System preferences"
              title="Settings"
              description="Tune how AirLock senses distance, inactivity, and external services."
            />
            <Row gutter={[20, 20]}>
              <Col xs={24} xl={15}>
                <Card
                  className="glass-card settings-card"
                  bordered={false}
                  title={
                    <Space>
                      <SettingOutlined />
                      Detection rules
                    </Space>
                  }
                >
                  <Form
                    form={form}
                    layout="vertical"
                    onFinish={saveSettings}
                    initialValues={settings ?? undefined}
                  >
                    <Form.Item
                      name="sensitivityLevel"
                      label="Security sensitivity"
                      extra="Higher sensitivity locks sooner when the phone moves away."
                    >
                      <Slider
                        min={1}
                        max={5}
                        marks={{
                          1: "Relaxed",
                          3: "Balanced",
                          5: "Strict",
                        }}
                      />
                    </Form.Item>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item
                          name="idleThreshold"
                          label="Idle threshold"
                          rules={[{ required: true }]}
                        >
                          <InputNumber
                            min={5}
                            max={600}
                            addonAfter="seconds"
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="rssiThreshold"
                          label="RSSI threshold"
                          rules={[{ required: true }]}
                        >
                          <InputNumber
                            min={-95}
                            max={-40}
                            addonAfter="dBm"
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item
                      name="useAiEngine"
                      label="AI decision engine"
                      valuePropName="checked"
                      extra="When unavailable, AirLock automatically falls back to local rules."
                    >
                      <Switch
                        checkedChildren="AI on"
                        unCheckedChildren="Local only"
                      />
                    </Form.Item>
                    <Form.Item
                      name="mqttBrokerUrl"
                      label="MQTT broker"
                      rules={[
                        { required: true, message: "Enter the broker address" },
                      ]}
                    >
                      <Input
                        prefix={<CloudServerOutlined />}
                        placeholder="mqtt://localhost:1883"
                      />
                    </Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      icon={<SaveOutlined />}
                      size="large"
                    >
                      Save changes
                    </Button>
                  </Form>
                </Card>
              </Col>
              <Col xs={24} xl={9}>
                <Card
                  className="glass-card settings-card"
                  bordered={false}
                  title={
                    <Space>
                      <ApiOutlined />
                      Integration status
                    </Space>
                  }
                >
                  <div className="integration-row">
                    <Avatar
                      icon={<ThunderboltFilled />}
                      className="integration-icon"
                    />
                    <div>
                      <Text strong>Decision engine</Text>
                      <br />
                      <Text type="secondary">
                        {settings?.useAiEngine
                          ? "AI predictions with local fallback"
                          : "Local rules only"}
                      </Text>
                    </div>
                    <CheckCircleFilled className="integration-check" />
                  </div>
                  <div className="integration-row">
                    <Avatar
                      icon={<RobotOutlined />}
                      className="integration-icon"
                    />
                    <div>
                      <Text strong>Guard robot</Text>
                      <br />
                      <Text type="secondary">
                        {robot ? `Online · ${robot.state}` : "Awaiting telemetry"}
                      </Text>
                    </div>
                    <Badge status={robot ? "success" : "default"} />
                  </div>
                  <Alert
                    type="info"
                    showIcon
                    message="Changes apply immediately"
                    description="The monitoring agent does not need to be restarted."
                  />
                </Card>
              </Col>
            </Row>
          </section>
        )}
      </Content>
    </Layout>
  );
}

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <Text className="eyebrow">{eyebrow}</Text>
        <Title level={2}>{title}</Title>
        <Paragraph type="secondary">{description}</Paragraph>
      </div>
      {action}
    </header>
  );
}

interface DashboardProps {
  context: ContextState | null;
  robot: RobotStatus | null;
  actionLoading: "lock" | "unlock" | null;
  onLock: () => void;
  onUnlock: () => void;
}

function Dashboard({
  context,
  robot,
  actionLoading,
  onLock,
  onUnlock,
}: DashboardProps) {
  const decision = context?.decision ?? "WAIT";
  const meta = decisionMeta[decision];
  const confidence = context?.confidence ?? 0;

  return (
    <section className="page page-enter">
      <PageHeader
        eyebrow="Live command center"
        title="Good to see you."
        description="Your workstation, phone, and guard robot are monitored in real time."
        action={
          <Space>
            <Button
              icon={<UnlockOutlined />}
              onClick={onUnlock}
              loading={actionLoading === "unlock"}
            >
              Reset state
            </Button>
            <Button
              danger
              type="primary"
              icon={<LockOutlined />}
              onClick={onLock}
              loading={actionLoading === "lock"}
            >
              Lock now
            </Button>
          </Space>
        }
      />

      <Card className="hero-card glass-card" bordered={false}>
        <div className="hero-grid">
          <div className="security-visual" style={{ color: meta.color }}>
            <div className="radar-ring ring-one" />
            <div className="radar-ring ring-two" />
            <div className="radar-ring ring-three" />
            <div
              className="security-core"
              style={{ background: meta.soft, boxShadow: `0 0 50px ${meta.soft}` }}
            >
              {meta.icon}
            </div>
          </div>
          <div className="hero-copy">
            <Space size={10}>
              <Badge status="processing" />
              <Text className="live-label">LIVE PROTECTION</Text>
            </Space>
            <Title level={1} style={{ color: meta.color }}>
              {meta.label}
            </Title>
            <Paragraph>
              {context?.reason || "Collecting the first sensor sample…"}
            </Paragraph>
            <div className="confidence-row">
              <div>
                <Text type="secondary">Decision confidence</Text>
                <strong>{confidence}%</strong>
              </div>
              <Progress
                percent={confidence}
                showInfo={false}
                strokeColor={{
                  "0%": "#38bdf8",
                  "100%": meta.color,
                }}
                trailColor="rgba(148, 163, 184, .12)"
              />
            </div>
          </div>
          <div className="hero-status">
            <div>
              <Text type="secondary">Last sample</Text>
              <strong>
                {context
                  ? new Date(context.timestamp * 1000).toLocaleTimeString()
                  : "Waiting"}
              </strong>
            </div>
            <div>
              <Text type="secondary">Current policy</Text>
              <strong>{decisionTag(decision)}</strong>
            </div>
          </div>
        </div>
      </Card>

      <Row gutter={[16, 16]} className="metrics-row">
        <MetricCard
          title="Idle time"
          value={context?.idleTime ?? 0}
          suffix="sec"
          icon={<FieldTimeOutlined />}
          accent="#a78bfa"
          detail={context?.keyboardActive ? "Keyboard active" : "No key activity"}
          active={context?.keyboardActive}
        />
        <MetricCard
          title="Phone signal"
          value={context?.rssi ?? 0}
          suffix="dBm"
          icon={<WifiOutlined />}
          accent="#38bdf8"
          detail={signalLabel(context?.rssi)}
          active={(context?.rssi ?? -100) >= -75}
        />
        <MetricCard
          title="Phone battery"
          value={context?.battery ?? 0}
          suffix="%"
          icon={<ThunderboltOutlined />}
          accent="#2dd4bf"
          detail={context?.charging ? "Currently charging" : "On battery"}
          active={context?.charging}
        />
        <MetricCard
          title="Mouse"
          value={context?.mouseActive ? "Active" : "Still"}
          icon={<SelectOutlined />}
          accent="#fb7185"
          detail={context?.phoneMoving ? "Phone is moving" : "Phone is stationary"}
          active={context?.mouseActive}
        />
      </Row>

      <Row gutter={[20, 20]} className="lower-grid">
        <Col xs={24} xl={15}>
          <Card
            className="glass-card device-card"
            bordered={false}
            title={
              <Space>
                <MobileOutlined />
                Device context
              </Space>
            }
            extra={<Tag color="cyan">{context?.wifiSSID || "No Wi-Fi"}</Tag>}
          >
            <Row gutter={[14, 14]}>
              <ContextTile
                label="Keyboard"
                value={context?.keyboardActive ? "Active" : "Inactive"}
                online={context?.keyboardActive}
              />
              <ContextTile
                label="Mouse"
                value={context?.mouseActive ? "Active" : "Inactive"}
                online={context?.mouseActive}
              />
              <ContextTile
                label="Phone motion"
                value={context?.phoneMoving ? "Moving" : "Stationary"}
                online={context?.phoneMoving}
              />
              <ContextTile
                label="Signal quality"
                value={signalLabel(context?.rssi)}
                online={(context?.rssi ?? -100) >= -75}
              />
            </Row>
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card
            className={`glass-card robot-card ${
              robot?.intruderDetected ? "danger-pulse" : ""
            }`}
            bordered={false}
            title={
              <Space>
                <RobotOutlined />
                Guard robot
              </Space>
            }
            extra={
              <Badge
                status={robot ? "success" : "default"}
                text={robot ? "Connected" : "Waiting"}
              />
            }
          >
            {robot ? (
              <>
                {robot.intruderDetected && (
                  <Alert
                    className="intruder-alert"
                    type="error"
                    showIcon
                    message="Intruder detected"
                  />
                )}
                <div className="robot-state">
                  <Avatar
                    size={58}
                    icon={<RobotOutlined />}
                    className="robot-avatar"
                  />
                  <div>
                    <Title level={4}>{robot.state}</Title>
                    <Text type="secondary">
                      Nearest object {robot.distanceToNearestObject} cm away
                    </Text>
                  </div>
                </div>
                <Text type="secondary">Robot battery</Text>
                <Progress
                  percent={robot.batteryLevel}
                  strokeColor="#2dd4bf"
                  trailColor="rgba(148, 163, 184, .12)"
                />
              </>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Waiting for robot telemetry"
              />
            )}
          </Card>
        </Col>
      </Row>
    </section>
  );
}

interface MetricCardProps {
  title: string;
  value: string | number;
  suffix?: string;
  icon: React.ReactNode;
  accent: string;
  detail: string;
  active?: boolean;
}

function MetricCard({
  title,
  value,
  suffix,
  icon,
  accent,
  detail,
  active,
}: MetricCardProps) {
  return (
    <Col xs={24} sm={12} xxl={6}>
      <Card className="metric-card glass-card" bordered={false}>
        <div className="metric-top">
          <Avatar
            shape="square"
            icon={icon}
            style={{ color: accent, background: `${accent}18` }}
          />
          <Badge status={active ? "processing" : "default"} />
        </div>
        <Statistic
          title={title}
          value={value}
          suffix={suffix}
          valueStyle={{ color: "#f8fafc" }}
        />
        <Text type="secondary">{detail}</Text>
      </Card>
    </Col>
  );
}

function ContextTile({
  label,
  value,
  online,
}: {
  label: string;
  value: string;
  online?: boolean;
}) {
  return (
    <Col xs={24} sm={12}>
      <div className="context-tile">
        <div>
          <Text type="secondary">{label}</Text>
          <strong>{value}</strong>
        </div>
        <div className={`activity-dot ${online ? "is-online" : ""}`} />
      </div>
    </Col>
  );
}
