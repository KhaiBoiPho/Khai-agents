import {Container} from "@mantine/core";
import SpaceHomeTabs from "@/features/space/components/space-home-tabs.tsx";
import SpacePublicNotice from "@/features/public-space/components/space-public-notice.tsx";
import {useParams} from "react-router-dom";
import {useGetSpaceBySlugQuery} from "@/features/space/queries/space-query.ts";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
// KhaiDocs: Notion-style home in single-user mode (MIT, ../../../notion).
import { SINGLE_USER } from "@/lib/khaidocs-mode.ts";
import { KhaiDocsHome } from "../../../notion/Home";

export default function SpaceHome() {
    const {spaceSlug} = useParams();
    const {data: space} = useGetSpaceBySlugQuery(spaceSlug);

    // KhaiDocs: the single user's workspace home.
    if (SINGLE_USER) {
        return space ? <KhaiDocsHome space={space} /> : null;
    }

    return (
        <>
            <DocumentTitle title={space?.name || 'Overview'} />
            <Container size={"900"} pt="xl">
                {space && <SpacePublicNotice space={space} />}
                {space && <SpaceHomeTabs/>}
            </Container>
        </>
    );
}
