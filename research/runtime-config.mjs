// Public, portable loopback addresses. Environment overrides support isolated runs.
const names={8765:'ECF_FIELD_PORT',8766:'ECF_R1_PORT',8767:'ECF_R2_PORT',8768:'ECF_R3_PORT'};
export function portFor(defaultPort){const value=Number(process.env[names[defaultPort]]??defaultPort);if(!Number.isInteger(value)||value<1024||value>65535)throw Error('invalid loopback port');return value;}
export const originFor=port=>`http://127.0.0.1:${portFor(port)}`;
