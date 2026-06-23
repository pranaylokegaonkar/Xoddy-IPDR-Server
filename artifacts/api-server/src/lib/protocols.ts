const PROTOCOL_NAMES: Record<number, string> = {
  1: "ICMP",
  2: "IGMP",
  6: "TCP",
  17: "UDP",
  41: "IPv6",
  47: "GRE",
  50: "ESP",
  51: "AH",
  58: "ICMPv6",
  89: "OSPF",
  132: "SCTP",
};

export function protocolName(protocol: number): string {
  return PROTOCOL_NAMES[protocol] ?? `IP/${protocol}`;
}
