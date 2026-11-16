class SitegenError(Exception):
    pass


class FrontmatterError(SitegenError, ValueError):
    pass


class TemplateError(SitegenError):
    pass


class BuildError(SitegenError):
    pass
