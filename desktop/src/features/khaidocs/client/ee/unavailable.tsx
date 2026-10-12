/*
 * KhaiDocs stand-in for an enterprise module. Original code, MIT.
 * The upstream Enterprise Edition is not included: it is licensed separately
 * and may not be used without a subscription. Every enterprise
 * feature reports as unavailable.
 */

import { Center, Stack, Text, Title } from "@mantine/core";

/** Shown for every route that belongs to an enterprise tier. */
export default function Unavailable(_props: Record<string, unknown>) {
  return (
    <Center h="100%" p="xl">
      <Stack align="center" gap={4}>
        <Title order={3}>Not available in KhaiDocs</Title>
        <Text c="dimmed" size="sm">
          This is an enterprise feature, which KhaiDocs does not include.
        </Text>
      </Stack>
    </Center>
  );
}
